import cron from 'node-cron'
import { MongoClient } from 'mongodb'
import dayjs from 'dayjs'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import xml2js from 'xml2js'
import utc from 'dayjs/plugin/utc.js'
import { connectSftpThroughProxy } from '../../routes/connectSftpViaProxy.js'
dayjs.extend(utc)

const logger = createLogger()
const MONGO_URI = config.get('mongo')
async function runForecastSyncJob() {
  logger.info('[Seeder] Running MetOffice forecast seed script...')

  const client = new MongoClient(MONGO_URI.uri)
  const today = dayjs().startOf('day').toDate()
  // const filename = `MetOfficeDefraAQSites_${dayjs().format('YYYYMMDD')}.xml`
  const filename = `MetOfficeDefraAQSites_20250526.xml`
  try {
    await client.connect()
    const db = client.db('aqie-forecast-api')
    const forecastsCol = db.collection('forecasts')

    const exists = await forecastsCol.countDocuments({
      updated: { $gte: today }
    })

    if (exists > 0) {
      logger.info(
        '[Seeder] Forecast already exists for today. Skipping insert.'
      )
      return
    }
    const sftp = await connectSftpThroughProxy()
    const remotePath = `/Incoming Shares/AQIE/MetOffice/${filename}`

    const xmlBuffer = await sftp.get(remotePath)
    const xmlContent = xmlBuffer.toString('utf8')

    const forecastDocs = await parseForecastXml(xmlContent)
    await forecastsCol.insertMany(forecastDocs)

    logger.info(`[Seeder] Inserted ${forecastDocs.length} forecast records.`)

    sftp.end()
  } catch (err) {
    logger.error(`[Seeder] Error: ${JSON.stringify(err)}`, err)
  } finally {
    await client.close()
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
cron.schedule('55 19 * * *', async () => {
  await runForecastSyncJob()
})
