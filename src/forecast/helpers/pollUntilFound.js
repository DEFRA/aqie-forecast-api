/** This polling loops continue polling every 15 minutes until the file is found and successfully parsed and inserted into the database
 * Connect → Check → Disconnect → Sleep → Repeat
 * After sleeping, the script re-establishes a new SFTP connection
 */
import { config } from '../../config.js'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'

dayjs.extend(utc)

export const pollUntilFound = async ({
  filename,
  logger,
  forecastsCol,
  parseForecastXml,
  connectSftp,
  sleep
}) => {
  const today = dayjs().utc().startOf('day')
  const cutoffTime = today.endOf('day') // 11:59 PM UTC
  const alertTime = today.add(10, 'hour') // 10:00 AM UTC
  let alertSent = false

  while (dayjs().utc().isBefore(cutoffTime)) {
    const now = dayjs().utc()

    // Send alert at 10:00 AM if file still not found
    if (!alertSent && now.isAfter(alertTime)) {
      logger.error(
        `[Alert] Forecast file not uploaded to MetOffice SFTP server for ${today.format('YYYY-MM-DD')}`
      )
      logger.warn(
        `[Alert] Forecast file not uploaded to MetOffice SFTP server for ${today.format('YYYY-MM-DD')}`
      )
      alertSent = true
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
          break // Exit loop on success
        } catch (err) {
          logger.error(
            `[XML Parsing Error] File found but could not be parsed: ${err.message}`,
            err
          )
          // logger.warn(`[Alert] Forecast file for ${dayjs().utc().format('YYYY-MM-DD')} is invalid or corrupted.`)
          throw err instanceof Error ? err : new Error(String(err))
        }
      } else {
        logger.info(`[SFTP] File ${filename} not found. Retrying in 15 mins.`)
        await sftp.end()
        await sleep(config.get('forecastRetryInterval'))
      }
    } catch (err) {
      logger.error(`[Error] While checking SFTP: ${err.message}`, err)
      logger.info('[Retry] Waiting 15 mins before next attempt.')
      await sleep(config.get('forecastRetryInterval'))
    }
  }
  logger.info(
    `[Polling Ended] Forecast file not found by cutoff time (${cutoffTime.format()}).`
  )
}
