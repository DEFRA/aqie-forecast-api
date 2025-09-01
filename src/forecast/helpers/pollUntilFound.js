/** This polling loops continue polling every 15 minutes until the file is found and successfully parsed and inserted into the database
 * Connect → Check → Disconnect → Sleep → Repeat
 * After sleeping, the script re-establishes a new SFTP connection
 */
import { config } from '../../config.js'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import tz from 'dayjs/plugin/timezone.js'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js'

dayjs.extend(utc)
dayjs.extend(tz)
dayjs.extend(isSameOrAfter)

const TIMEZONE = 'Europe/London'

export const pollUntilFound = async ({
  filename,
  logger,
  forecastsCol,
  parseForecastXml,
  connectSftp,
  sleep
}) => {
  const today = dayjs().tz(TIMEZONE).startOf('day') // UK local midnight
  const cutoffTime = today.add(23, 'hour').add(30, 'minute') // 11:30pm UK time
  const alertTimes = [
    today.add(10, 'hour').add(0, 'minute'), // 10:00 UK time
    today.add(15, 'hour').add(0, 'minute') // 15:00 UK time
  ]
  const alertsSent = new Set() // Track which alerts are already sent

  logger.info(
    `[Polling Start] Will stop polling at: ${cutoffTime.format('YYYY-MM-DD HH:mm:ss')} (${TIMEZONE})`
  )

  while (true) {
    const now = dayjs().tz(TIMEZONE)

    // Stop polling if cutoff time passed
    if (now.isAfter(cutoffTime)) {
      logger.info(
        `[Polling Ended] Forecast file not found by cutoff time (${cutoffTime.format('YYYY-MM-DD HH:mm:ss')} ${TIMEZONE}).`
      )
      break
    }

    // Check both 10:00 and 15:00 alerts
    for (const alertTime of alertTimes) {
      const alertLabel = alertTime.format('HH:mm')
      // If current time is equal or after alert time → log it
      if (!alertsSent.has(alertLabel) && now.isSameOrAfter(alertTime)) {
        logger.error(
          `[Alert] Forecast file not uploaded to MetOffice SFTP for ${today.format('YYYY-MM-DD')} - Time: ${alertLabel} (${TIMEZONE})`
        )
        alertsSent.add(alertLabel)
      }
    }

    logger.info(`[SFTP] Connecting to check for file ${filename}`)
    try {
      const { sftp } = await connectSftp()
      const remotePath = `/Incoming Shares/AQIE/MetOffice/`
      const files = await sftp.list(remotePath)

      const fileFound = files.find(
        (file) => file.name.trim() === filename.trim()
      )
      logger.info(`[SFTP] File Match ${JSON.stringify(fileFound)} found.`)

      if (fileFound) {
        logger.info(`[SFTP] File ${filename} found. Fetching content...`)
        const fileContent = await sftp.get(`${remotePath}${filename}`)
        await sftp.end()
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
          break // Stop polling after success
        } catch (err) {
          logger.error(
            `[XML Parsing Error] File found but could not be parsed: ${err.message}`,
            err
          )
          throw err instanceof Error ? err : new Error(String(err))
        }
      } else {
        logger.info(
          `[SFTP] File ${filename} not found. Retrying in ${config.get('forecastRetryInterval') / 60000} mins.`
        )
        await sftp.end()
        await sleep(config.get('forecastRetryInterval'))
      }
    } catch (err) {
      logger.error(`[Error] While checking SFTP: ${err.message}`, err)
      logger.info(
        `[Retry] Waiting ${config.get('forecastRetryInterval') / 60000} mins before next attempt.`
      )
      await sleep(config.get('forecastRetryInterval'))
    }
  }
}
