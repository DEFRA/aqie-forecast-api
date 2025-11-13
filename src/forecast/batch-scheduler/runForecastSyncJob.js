/**
 * sleep is implemented using this helper function
 * and it's used in two places inside the pollUntilFound function:
 * 1) File Not Found on SFTP: script waits 15 minutes before trying again.
 * 2) Error While Connecting to SFTP: script logs the error and waits 15 minutes before retrying.
 */
/* eslint-disable */
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import {
  getExpectedFileName,
  getExpectedSummaryFileName,
  sleep
} from '../helpers/utility.js'
import { pollUntilFound } from '../helpers/pollUntilFound.js'
import { parseForecastXml } from '../helpers/parse-forecast-xml.js'
import { parseForecastSummaryTxt } from '../helpers/parse-forecast-summary-txt.js'
import {
  COLLECTION_NAME,
  SUMMARY_COLLECTION_NAME
} from '../helpers/constant.js'
import {
  connectSftpThroughProxy,
  connectLocalSftp
} from '../helpers/connectSftpViaProxy.js'

const logger = createLogger()
dayjs.extend(utc)

async function runForecastSyncJob(server) {
  logger.info('[Seeder] Running MetOffice forecast & summary seed script...')

  // Acquire locks for both collections to prevent concurrent jobs
  const forecastLock = await server.locker.lock(COLLECTION_NAME)
  logger.info(`:::::::LOCKED (forecast & summary):::::::`)
  if (!forecastLock) {
    logger.error(`Failed to acquire lock for resource - forecasts`)
    return null
  }

  // Generate today's expected filenames for forecast and summary
  const filename = getExpectedFileName()
  const summaryFilename = getExpectedSummaryFileName()
  logger.info(`Today's Forecast Filename::: ${filename}`)
  logger.info(`Today's Summary Filename::: ${summaryFilename}`)

  // Calculate today's UTC start and end for DB queries
  const todayStart = dayjs().utc().startOf('day').toDate()
  const todayEnd = dayjs().utc().endOf('day').toDate()

  try {
    // --- Forecast Collection Setup ---
    // Ensure the forecast collection exists and has a unique index on 'name'
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
      await forecastsCol.createIndex({ name: 1 }, { unique: true })
      logger.info("Ensured unique index on 'name'")
    } catch (err) {
      logger.error(`"Failed to create index on 'name':", ${err.message}`, err)
    }
    // Check if today's forecast already exists
    const forecastExists = await forecastsCol.countDocuments({
      updated: { $gte: todayStart, $lte: todayEnd }
    })
    logger.info(`forecast collection exists ${forecastExists}`)

    // --- Summary Collection Setup ---
    // Ensure the summary collection exists and has a unique index on 'name'
    const summaryCollections = await server.db
      .listCollections({ name: SUMMARY_COLLECTION_NAME })
      .toArray()
    logger.info(`summary collection length ${summaryCollections.length}`)
    if (summaryCollections.length === 0) {
      await server.db.createCollection(SUMMARY_COLLECTION_NAME)
      logger.info(`[MongoDB] Created collection '${SUMMARY_COLLECTION_NAME}'`)
    }
    const summaryCol = await server.db.collection(SUMMARY_COLLECTION_NAME)
    try {
      await summaryCol.createIndex({ name: 1 }, { unique: true })
      logger.info('Ensured unique index name for summary')
    } catch (err) {
      logger.error(
        `"Failed to create index name for summary:", ${err.message}`,
        err
      )
    }
    // Check if today's summary already exists
    const summaryExists = await summaryCol.countDocuments({
      updated: { $gte: todayStart, $lte: todayEnd }
    })
    logger.info(`summary collection exists ${summaryExists}`)

    // If both forecast and summary already exist for today, skip polling
    if (forecastExists > 0 && summaryExists > 0) {
      logger.info(
        '[Seeder] Forecast and Summary already exist for today. Skipping insert.'
      )
      return
    }

    /**
     * Unified polling for both forecast and summary.
     * This polling loop continues polling every 15 minutes until both files are found and processed.
     * - Handles SFTP connection, file checking, parsing, and DB upsert for both files.
     * - Uses the same retry/sleep logic for both.
     */
    await pollUntilFound({
      type: 'both',
      filename,
      summaryFilename,
      forecastsCol,
      parseForecastXml,
      summaryCol,
      parseForecastSummaryTxt,
      logger,
      connectSftp: connectSftpThroughProxy,
      sleep
    })
  } catch (err) {
    logger.error(
      `[Forecast & Summary Scheduler Sync Job Error] ${err.message}`,
      err
    )
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    logger.info(`::::::::::UNLOCKED (forecast & summary)::::::::`)
    await forecastLock.free()
  }
}

export { runForecastSyncJob }
