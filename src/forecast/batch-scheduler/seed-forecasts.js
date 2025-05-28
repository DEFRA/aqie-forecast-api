import { schedule } from 'node-cron'
// import { MongoClient } from 'mongodb'
import dayjs from 'dayjs'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import xml2js from 'xml2js'
import utc from 'dayjs/plugin/utc.js'
import { connectSftpThroughProxy } from '../../test/connectSftpViaProxy.js'
dayjs.extend(utc)

const logger = createLogger()
// const MONGO_URI = config.get('mongo')
const COLLECTION_NAME = 'forecasts'

async function runForecastSyncJob(server) {
  logger.info('[Seeder] Running MetOffice forecast seed script...')

  // const client = new MongoClient(MONGO_URI.uri)
  // const today = dayjs().startOf('day').toDate()
  // const filename = `MetOfficeDefraAQSites_${dayjs().format('YYYYMMDD')}.xml`
  const filename = `MetOfficeDefraAQSites_20250526.xml`
  try {
    // await client.connect()
    // const db = server.db('aqie-forecast-api')
    const collections = await server.db
      .listCollections({ name: COLLECTION_NAME })
      .toArray()
    logger.info(`collection length ${collections.length}`)
    if (collections.length === 0) {
      await server.db.createCollection(COLLECTION_NAME)
      logger.info(`[MongoDB] Created collection '${COLLECTION_NAME}'`)
    }
    const forecastsCol = await server.db.collection(COLLECTION_NAME)
    const todayStart = dayjs().startOf('day').toDate()
    const todayEnd = dayjs().endOf('day').toDate()

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
    const { sftp } = await connectSftpThroughProxy()
    const remotePath = `/Incoming Shares/AQIE/MetOffice/${filename}`

    const xmlBuffer = await sftp.get(remotePath)
    const xmlContent = xmlBuffer.toString('utf8')

    let parsedForecasts
    try {
      parsedForecasts = await parseForecastXml(xmlContent)
    } catch (err) {
      logger.error(
        `[XML Parsing Error] Failed to parse forecast XML: ${err.message}`
      )
      throw err
    }

    logger.info(
      `PARSED XML FILE CONTENT :: ${JSON.stringify(parsedForecasts[0], null, 2)}`
    )
    logger.info(typeof parsedForecasts[0].updated)
    logger.info(parsedForecasts[0].updated)
    // await forecastsCol.insertMany(forecastDocs)

    logger.info(`[Seeder] Inserted ${parsedForecasts.length} forecast records.`)
    const bulkOps = parsedForecasts.map((forecast) => ({
      replaceOne: {
        filter: { name: forecast.name },
        replacement: { forecast },
        upsert: true // if not found, insert it
      }
    }))

    await forecastsCol.bulkWrite(bulkOps)

    logger.info(
      `[DB] Forecasts inserted successfully for ${parsedForecasts.length} locations.`
    )
    await sftp.end()
  } catch (err) {
    logger.error(`[Seeder] Error: ${JSON.stringify(err)}`, err)
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
      // await fetchAndSaveForecasts(server)
      logger.info('starting forecasts Scheduler')
      logger.info(
        `Forecasts Scheduler Server time at startup: ${new Date().toString()}`
      )
      logger.info(
        `'Using forecast schedule:', ${config.get('seedForecastSchedule')}`
      )
      schedule(
        '15 22 * * *',
        async () => {
          logger.info('Cron job triggered')
          await runForecastSyncJob(server)
        }
        // {
        //   timezone: 'Europe/London' // or 'UTC' if you prefer UTC
        // }
      )
      logger.info('Inital forecasts Scheduler done! Running at 5am to 10am')
    }
  }
}

export { seedForecastScheduler }
