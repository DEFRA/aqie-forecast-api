/**
 * This polling loop continues polling every 15 minutes until both forecast and summary files
 * are found, parsed, and inserted into the database.
 *
 * The process is:
 *   1. Connect to SFTP
 *   2. Check for both files
 *   3. Disconnect from SFTP
 *   4. Sleep if not found, then repeat
 *
 * Alerts are logged at 10:00 and 15:00 UK time if files are still missing.
 * Polling stops at 11:30pm UK time.
 */
import { config } from '../../config.js'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import tz from 'dayjs/plugin/timezone.js'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js'
import {
  FIFTEEN,
  TEN,
  RETRY_MINUTES,
  THIRTY,
  TWENTY_THREE
} from '../helpers/constant.js'

dayjs.extend(utc)
dayjs.extend(tz)
dayjs.extend(isSameOrAfter)

const TIMEZONE = 'Europe/London'

function getAlertTimes(today) {
  return [today.add(TEN, 'hour'), today.add(FIFTEEN, 'hour')]
}

function getMissingFiles(forecastDone, summaryDone, type) {
  const missing = []
  if ((type === 'both' || type === 'forecast') && !forecastDone) {
    missing.push('forecast')
  }
  if ((type === 'both' || type === 'summary') && !summaryDone) {
    missing.push('summary')
  }
  return missing
}

function logAlerts({
  now,
  today,
  alertTimes,
  alertsSent,
  forecastDone,
  summaryDone,
  type,
  logger
}) {
  for (const alertTime of alertTimes) {
    const alertLabel = alertTime.format('HH:mm')
    if (!alertsSent.has(alertLabel) && now.isSameOrAfter(alertTime)) {
      logger.error(
        `[Alert] Forecast file not uploaded to MetOffice SFTP for ${today.format('YYYY-MM-DD')} - Time: ${alertLabel} (${TIMEZONE})`
      )
      const missingFiles = getMissingFiles(forecastDone, summaryDone, type)
      if (missingFiles.length > 0) {
        logger.error(
          `[Alert] The following file(s) were not uploaded to MetOffice SFTP for ${today.format('YYYY-MM-DD')} - Time: ${alertLabel} (${TIMEZONE}): ${missingFiles.join(', ')}.`
        )
      }
      alertsSent.add(alertLabel)
    }
  }
}

async function processForecast({
  sftp,
  files,
  filename,
  forecastsCol,
  parseForecastXml,
  remotePath,
  logger
}) {
  if (!filename) {
    return false
  }
  const fileFound = files.find((f) => f.name.trim() === filename.trim())
  logger.info(`[SFTP] Forecast File Match ${JSON.stringify(fileFound)} found.`)
  if (!fileFound) {
    logger.info(`[SFTP] Forecast file ${filename} not found.`)
    return false
  }
  logger.info(`[SFTP] Forecast file ${filename} found. Fetching content...`)
  const fileContent = await sftp.get(`${remotePath}${filename}`)
  try {
    const parsedForecasts = await parseForecastXml(fileContent)
    const bulkOps = (forecast) => ({
      replaceOne: {
        filter: { name: forecast.name },
        replacement: forecast,
        upsert: true
      }
    })
    await forecastsCol.bulkWrite(parsedForecasts.map(bulkOps))
    logger.info(
      `[DB] Forecasts inserted successfully for ${parsedForecasts.length} locations.`
    )
    return true
  } catch (err) {
    logger.error(
      `[XML Parsing Error] Forecast file found but could not be parsed: ${err.message}`,
      err
    )
    throw err instanceof Error ? err : new Error(String(err))
  }
}

async function processSummary({
  sftp,
  files,
  summaryFilename,
  summaryCol,
  parseForecastSummaryTxt,
  remotePath,
  logger
}) {
  if (!summaryFilename) {
    return false
  }
  const summaryFileFound = files.find(
    (f) => f.name.startsWith(summaryFilename) && /\.txt$/i.test(f.name)
  )
  logger.info(
    `[SFTP] Summary File Match ${JSON.stringify(summaryFileFound)} found.`
  )
  if (!summaryFileFound) {
    logger.info(`[SFTP] Summary file ${summaryFilename} not found.`)
    return false
  }
  logger.info(
    `[SFTP] Summary file ${summaryFileFound.name} found. Fetching content...`
  )
  const fileContent = await sftp.get(`${remotePath}${summaryFileFound.name}`)
  try {
    const parsed = parseForecastSummaryTxt(fileContent.toString())
    logger.info(`parsed content - ${JSON.stringify(parsed)}`)
    const currentDate = dayjs().tz(TIMEZONE).format('YYYY-MM-DD')
    const issueDate = dayjs(parsed.issue_date).format('YYYY-MM-DD')

    if (issueDate !== currentDate) {
      logger.info(
        `[SFTP] Summary file ${summaryFileFound.name} has outdated issue_date: ${issueDate}. Expected: ${currentDate}. Skipping.`
      )
      return false
    }

    await summaryCol.replaceOne(
      { type: 'latest' },
      {
        type: 'latest',
        name: summaryFileFound.name,
        ...parsed,
        updated: new Date()
      },
      { upsert: true }
    )
    logger.info(
      `[MongoDB] Upserted latest summary for ${summaryFileFound.name}`
    )
    return true
  } catch (err) {
    logger.error(
      `[TXT Parsing Error] Summary file found but could not be parsed: ${err.message}`,
      err
    )
    throw err instanceof Error ? err : new Error(String(err))
  }
}

async function handleSftpError(err, logger, sleep) {
  logger.error(`[Error] While checking SFTP: ${err.message}`, err)
  logger.info(
    `[Retry] Waiting ${config.get('forecastRetryInterval') / RETRY_MINUTES} mins before next attempt.`
  )
  await sleep(config.get('forecastRetryInterval'))
}

function initializePollingState(type) {
  return {
    forecastDone: !(type === 'both' || type === 'forecast'),
    summaryDone: !(type === 'both' || type === 'summary'),
    needsForecast: type === 'both' || type === 'forecast',
    needsSummary: type === 'both' || type === 'summary'
  }
}

function shouldContinuePolling(state) {
  return (
    (state.needsForecast && !state.forecastDone) ||
    (state.needsSummary && !state.summaryDone)
  )
}

function logConnectionAttempt(state, filename, summaryFilename, logger) {
  const lookingFor = []
  if (state.needsForecast) {
    lookingFor.push(filename)
  }
  if (state.needsSummary) {
    lookingFor.push(summaryFilename)
  }

  logger.info(
    `[SFTP] Connecting to check for files: ${lookingFor.filter(Boolean).join(' and ')}`
  )
}

async function processFiles({
  sftp,
  files,
  state,
  filename,
  summaryFilename,
  forecastsCol,
  parseForecastXml,
  summaryCol,
  parseForecastSummaryTxt,
  remotePath,
  logger
}) {
  // Only process forecast if we need it and haven't found it yet
  if (state.needsForecast && !state.forecastDone) {
    state.forecastDone = await processForecast({
      sftp,
      files,
      filename,
      forecastsCol,
      parseForecastXml,
      remotePath,
      logger
    })
  }

  // Only process summary if we need it and haven't found it yet
  if (state.needsSummary && !state.summaryDone) {
    state.summaryDone = await processSummary({
      sftp,
      files,
      summaryFilename,
      summaryCol,
      parseForecastSummaryTxt,
      remotePath,
      logger
    })
  }
}

export const pollUntilFound = async ({
  type = 'both',
  filename,
  summaryFilename,
  forecastsCol,
  parseForecastXml,
  summaryCol,
  parseForecastSummaryTxt,
  logger,
  connectSftp,
  sleep
}) => {
  const today = dayjs().tz(TIMEZONE).startOf('day')
  const cutoffTime = today.add(TWENTY_THREE, 'hour').add(THIRTY, 'minute')
  const alertTimes = getAlertTimes(today)
  const alertsSent = new Set()
  const remotePath = config.get('metOfficeDirectory')

  logger.info(
    `[Polling Start] Will stop polling at: ${cutoffTime.format('YYYY-MM-DD HH:mm:ss')} (${TIMEZONE})`
  )

  const state = initializePollingState(type)

  while (shouldContinuePolling(state)) {
    const now = dayjs().tz(TIMEZONE)

    if (now.isAfter(cutoffTime)) {
      const missingFiles = getMissingFiles(
        state.forecastDone,
        state.summaryDone,
        type
      )
      logger.info(
        `[Polling Ended] The following file(s) were not found by cutoff time (${cutoffTime.format('YYYY-MM-DD HH:mm:ss')} ${TIMEZONE}): ${missingFiles.join(', ')}.`
      )
      break
    }

    logConnectionAttempt(state, filename, summaryFilename, logger)

    try {
      const { sftp } = await connectSftp()
      const files = await sftp.list(remotePath)

      await processFiles({
        sftp,
        files,
        state,
        filename,
        summaryFilename,
        forecastsCol,
        parseForecastXml,
        summaryCol,
        parseForecastSummaryTxt,
        remotePath,
        logger
      })

      await sftp.end()

      logAlerts({
        now,
        today,
        alertTimes,
        alertsSent,
        forecastDone: state.forecastDone,
        summaryDone: state.summaryDone,
        type,
        logger
      })

      if (shouldContinuePolling(state)) {
        logger.info(
          `[Polling] Not all files found. Retrying in ${config.get('forecastRetryInterval') / RETRY_MINUTES} mins.`
        )
        await sleep(config.get('forecastRetryInterval'))
      }
    } catch (err) {
      await handleSftpError(err, logger, sleep)
    }
  }
}
