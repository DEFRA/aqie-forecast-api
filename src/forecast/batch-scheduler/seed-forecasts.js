/* eslint-disable */
import { schedule } from 'node-cron'
// import { MongoClient } from 'mongodb'
import dayjs from 'dayjs'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import xml2js from 'xml2js'
import utc from 'dayjs/plugin/utc.js'
import {
  connectSftpThroughProxy,
  connectLocalSftp
} from '../../test/connectSftpViaProxy.js'
dayjs.extend(utc)

const logger = createLogger()
const COLLECTION_NAME = 'forecasts'

/**
 * sleep is implemented using this helper function
 * and it's used in two places inside the pollUntilFound function
 * The sleep is triggered in two scenarios:
 * 1) File Not Found on SFTP: then script waits 15 minutes before trying again
 * 2) Error While Connecting to SFTP: If there's an error during the SFTP connection
 * then script logs the error and waits 15 minutes before retrying.*/
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const getExpectedFileName = () => {
  const today = dayjs().format('YYYYMMDD')
  return `MetOfficeDefraAQSites_${today}.xml` //MetOfficeDefraAQSites_20250425.xml
}

async function runForecastSyncJob(server) {
  logger.info('[Seeder] Running MetOffice forecast seed script...')
  const filename = getExpectedFileName()
  logger.info(`Today's Forecast Filename::: ${filename}`)
  try {
    // await server.db.collection('forecasts').deleteMany({})
    logger.info(`db cleaned up`)
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
    const pollUntilFound = async () => {
      while (true) {
        logger.info(`[SFTP] Connecting to check for file ${filename}`)
        try {
          const { sftp } = await connectSftpThroughProxy()
          // const { sftp } = await connectLocalSftp()
          const remotePath = `/Incoming Shares/AQIE/MetOffice/`

          const files = await sftp.list(remotePath)

          // logger.info(`[SFTP] Files List ${JSON.stringify(files)} found.`)
          const fileFound = files.find(
            (files) => files.name.trim() === filename.trim()
          )
          logger.info(`[SFTP] File Match ${JSON.stringify(fileFound)} found.`)

          if (fileFound) {
            logger.info(`[SFTP] File ${filename} found. Fetching content...`)
            const fileContent = await sftp.get(`${remotePath}${filename}`)
            await sftp.end()
            let parsedForecasts
            try {
              parsedForecasts = await parseForecastXml(fileContent)
              const bulkOps = (forecast) => ({
                replaceOne: {
                  filter: { name: forecast.name },
                  replacement: forecast,
                  upsert: true // if not found, insert it
                }
              })

              await forecastsCol.bulkWrite(parsedForecasts.map(bulkOps))

              logger.info(
                `[DB] Forecasts inserted successfully for ${parsedForecasts.length} locations.`
              )

              break
            } catch (err) {
              logger.error(
                `[XML Parsing Error] Failed to parse forecast XML: ${err.message}`,
                err
              )
              throw err
            }
          } else {
            logger.info(
              `[SFTP] File ${filename} not found. Retrying in 15 mins.`
            )
            await sftp.end()
            await sleep(15 * 60 * 1000)
          }
        } catch (err) {
          logger.error(`[Error] While checking SFTP: ${err.message}`, err)
          logger.error(
            `JSON [Error] While checking SFTP: ${JSON.stringify(err)}`
          )
          logger.info('[Retry] Waiting 15 mins before next attempt.')
          await sleep(15 * 60 * 1000)
        }
      }
    }
    await pollUntilFound()
  } catch (err) {
    logger.error(`[Scheduler Error] ${err.message}`, err)
    logger.error(`JSON [Scheduler Error] ${JSON.stringify(err)}`)
    throw err
  }
}

const parseForecastXml = async (xmlString) => {
  const parsed = await xml2js.parseStringPromise(xmlString, {
    explicitArray: false
  })

  const sites = parsed.DEFRAAirQuality.site
  const siteArray = Array.isArray(sites) ? sites : [sites]

  return siteArray.map((site) => {
    // Construct UTC date from XML attributes
    const baseDate = dayjs.utc(
      `${site.$.yr}-${site.$.mon}-${site.$.dayn}T${site.$.hr.slice(0, 2)}:00:00`
    )
    //const updatedDate = baseDate.toISOString()

    const forecastDays = Array.isArray(site.day) ? site.day : [site.day]

    // Build forecast entries starting from the base date
    const forecast = forecastDays.slice(0, 5).map((d, index) => {
      return {
        day: baseDate.add(index, 'day').format('ddd'),
        value: parseInt(d.$.aq)
      }
    })

    return {
      name: site.$.lc,
      updated: baseDate.toDate(),
      location: {
        type: 'Point',
        coordinates: [parseFloat(site.$.lt), parseFloat(site.$.ln)]
      },
      forecast
    }
  })
}

// Schedule it to run daily at 5:00 AM
const seedForecastScheduler = {
  plugin: {
    name: 'Seed Forecast Scheduler',
    register: async (server) => {
      // Start the scheduler
      logger.info('starting forecasts Scheduler')
      logger.info(
        `Forecasts Scheduler Server time at startup: ${new Date().toString()}`
      )
      logger.info(
        `'Using forecast schedule:', ${config.get('forecastSchedule')}`
      )
      schedule(
        config.get('forecastSchedule'),
        async () => {
          logger.info('Cron job triggered')
          await runForecastSyncJob(server)
        }
        // {
        //   timezone: 'Europe/London' // or 'UTC' if you prefer UTC
        // }
      )
      logger.info('Inital forecasts Scheduler done! Running at 5am')
    }
  }
}

export { seedForecastScheduler }
