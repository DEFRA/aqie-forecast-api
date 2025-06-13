/** This polling loops continue polling every 15 minutes until the file is found and successfully parsed and inserted into the database
 * Connect → Check → Disconnect → Sleep → Repeat
 * After sleeping, the script re-establishes a new SFTP connection
 */
import { config } from '../../config.js'
export const pollUntilFound = async ({
  filename,
  logger,
  forecastsCol,
  parseForecastXml,
  connectSftp,
  sleep
}) => {
  while (true) {
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
          logger.error(`[XML Parsing Error] ${err.message}`, err)
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
}
