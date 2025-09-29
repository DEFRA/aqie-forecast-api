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
  // Calculate polling window and alert times
  const today = dayjs().tz(TIMEZONE).startOf('day') // UK local midnight
  const cutoffTime = today.add(TWENTY_THREE, 'hour').add(THIRTY, 'minute') // 11:30pm UK time
  const alertTimes = [
    today.add(TEN, 'hour').add(0, 'minute'), // 10:00 UK time
    today.add(FIFTEEN, 'hour').add(0, 'minute') // 15:00 UK time
  ]
  const alertsSent = new Set() // Track which alerts are already sent

  logger.info(
    `[Polling Start] Will stop polling at: ${cutoffTime.format('YYYY-MM-DD HH:mm:ss')} (${TIMEZONE})`
  )

  let forecastDone = false
  let summaryDone = false

  // Main polling loop: continues until both files are processed or cutoff time is reached
  while (!forecastDone || !summaryDone) {
    const now = dayjs().tz(TIMEZONE)

    if (now.isAfter(cutoffTime)) {
      const missingFiles = []
      if (!forecastDone) missingFiles.push('forecast')
      if (!summaryDone) missingFiles.push('summary')
      logger.info(
        `[Polling Ended] The following file(s) were not found by cutoff time (${cutoffTime.format('YYYY-MM-DD HH:mm:ss')} ${TIMEZONE}): ${missingFiles.join(', ')}.`
      )
      break
    }

    logger.info(
      `[SFTP] Connecting to check for files: ${filename} and ${summaryFilename}`
    )
    try {
      // Connect to SFTP and list files in the remote directory
      const { sftp } = await connectSftp()
      const remotePath = `/Incoming Shares/AQIE/MetOffice/`
      const files = await sftp.list(remotePath)

      // --- Forecast file check and processing ---
      if (!forecastDone && filename) {
        const fileFound = files.find(
          (file) => file.name.trim() === filename.trim()
        )
        logger.info(
          `[SFTP] Forecast File Match ${JSON.stringify(fileFound)} found.`
        )

        if (fileFound) {
          logger.info(
            `[SFTP] Forecast file ${filename} found. Fetching content...`
          )
          const fileContent = await sftp.get(`${remotePath}${filename}`)
          try {
            // Parse and upsert forecast data
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
            forecastDone = true
          } catch (err) {
            logger.error(
              `[XML Parsing Error] Forecast file found but could not be parsed: ${err.message}`,
              err
            )
            throw err instanceof Error ? err : new Error(String(err))
          }
        } else {
          logger.info(`[SFTP] Forecast file ${filename} not found.`)
        }
      }

      // --- Summary file check and processing ---
      if (!summaryDone && summaryFilename) {
        const summaryFileFound = files.find(
          (file) =>
            file.name.startsWith(summaryFilename) && file.name.endsWith('.TXT')
        )
        logger.info(
          `[SFTP] Summary File Match ${JSON.stringify(summaryFileFound)} found.`
        )

        if (summaryFileFound) {
          logger.info(
            `[SFTP] Summary file ${summaryFileFound.name} found. Fetching content...`
          )
          const fileContent = await sftp.get(
            `${remotePath}${summaryFileFound.name}`
          )
          try {
            // Parse and upsert summary data
            const parsed = parseForecastSummaryTxt(fileContent.toString())
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
            summaryDone = true
          } catch (err) {
            logger.error(
              `[TXT Parsing Error] Summary file found but could not be parsed: ${err.message}`,
              err
            )
            throw err instanceof Error ? err : new Error(String(err))
          }
        } else {
          logger.info(`[SFTP] Summary file ${summaryFilename} not found.`)
        }
      }

      // Disconnect from SFTP after each polling attempt
      await sftp.end()

      // Log alerts at 10:00 and 15:00 (original logic: always log)
      for (const alertTime of alertTimes) {
        const alertLabel = alertTime.format('HH:mm')
        if (!alertsSent.has(alertLabel) && now.isSameOrAfter(alertTime)) {
          // Original log (always log, for other teams)
          logger.error(
            `[Alert] Forecast file not uploaded to MetOffice SFTP for ${today.format('YYYY-MM-DD')} - Time: ${alertLabel} (${TIMEZONE})`
          )
          // New log (only log if files are missing)
          const missingFiles = []
          if (!forecastDone) missingFiles.push('forecast')
          if (!summaryDone) missingFiles.push('summary')
          if (missingFiles.length > 0) {
            logger.error(
              `[Alert] The following file(s) were not uploaded to MetOffice SFTP for ${today.format('YYYY-MM-DD')} - Time: ${alertLabel} (${TIMEZONE}): ${missingFiles.join(', ')}.`
            )
          }
          alertsSent.add(alertLabel)
        }
      }

      // If either file is still missing, sleep before next attempt
      if (!forecastDone || !summaryDone) {
        logger.info(
          `[Polling] Not all files found. Retrying in ${config.get('forecastRetryInterval') / RETRY_MINUTES} mins.`
        )
        await sleep(config.get('forecastRetryInterval'))
      }
    } catch (err) {
      // Handle SFTP connection or processing errors
      logger.error(`[Error] While checking SFTP: ${err.message}`, err)
      logger.info(
        `[Retry] Waiting ${config.get('forecastRetryInterval') / RETRY_MINUTES} mins before next attempt.`
      )
      await sleep(config.get('forecastRetryInterval'))
    }
  }
}
