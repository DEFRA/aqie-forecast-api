/**
 * sleep is implemented using this helper function
 * and it's used in two places inside the pollUntilFound function
 * The sleep is triggered in two scenarios:
 * 1) File Not Found on SFTP: then script waits 15 minutes before trying again
 * 2) Error While Connecting to SFTP: If there's an error during the SFTP connection
 * then script logs the error and waits 15 minutes before retrying.*/
/* eslint-disable */
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { getExpectedFileName, sleep } from '../helpers/utility.js'
import { pollUntilFound } from '../helpers/pollUntilFound.js'
import { parseForecastXml } from '../helpers/parse-forecast-xml.js'
import {
  connectSftpThroughProxy,
  connectLocalSftp
} from '../helpers/connectSftpViaProxy.js'

const logger = createLogger()
dayjs.extend(utc)

const COLLECTION_NAME = 'forecasts'

async function runForecastSyncJob(server) {
  logger.info('[Seeder] Running MetOffice forecast seed script...')
  const filename = getExpectedFileName()
  logger.info(`Today's Forecast Filename::: ${filename}`)
  try {
    // await server.db.collection('forecasts').deleteMany({})
    const collections = await server.db
      .listCollections({ name: COLLECTION_NAME })
      .toArray()
    logger.info(`collection length ${collections.length}`)
    if (collections.length === 0) {
      await server.db.createCollection(COLLECTION_NAME)
      logger.info(`[MongoDB] Created collection '${COLLECTION_NAME}'`)
    }
    const forecastsCol = await server.db.collection(COLLECTION_NAME)

    try {
      // Ensure unique index on 'name'
      await forecastsCol.createIndex({ name: 1 }, { unique: true })
      logger.info("Ensured unique index on 'name'")
    } catch (err) {
      logger.error(`"Failed to create index on 'name':", ${err.message}`, err)
    }

    const todayStart = dayjs().utc().startOf('day').toDate()
    // const todayStart = new Date('2025-05-26T00:00:00.000Z')
    const todayEnd = dayjs().utc().endOf('day').toDate()
    logger.info(
      `Checking for forecasts between ${todayStart.toISOString()} and ${todayEnd.toISOString()}`
    )

    const exists = await forecastsCol.countDocuments({
      updated: { $gte: todayStart, $lte: todayEnd }
    })
    logger.info(`collection is exist ${exists}`)
    if (exists > 0) {
      logger.info(
        '[Seeder] Forecast already exists for today. Skipping insert.'
      )
      return
    }
    /** This polling loops continue polling every 15 minutes until the file is found and successfully parsed and inserted into the database
     * Connect → Check → Disconnect → Sleep → Repeat
     * After sleeping, the script re-establishes a new SFTP connection
     */
    await pollUntilFound({
      filename,
      logger,
      forecastsCol,
      parseForecastXml,
      connectSftp: connectSftpThroughProxy, // or connectLocalSftp / connectSftpThroughProxy
      sleep
    })
  } catch (err) {
    logger.error(`[Forecast Scheduler Sync Job Error] ${err.message}`, err)
    // Optional: alerting or fallback logic here
    throw err instanceof Error ? err : new Error(String(err))
  }
}

export { runForecastSyncJob }
