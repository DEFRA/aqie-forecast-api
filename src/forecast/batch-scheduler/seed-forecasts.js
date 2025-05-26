// scripts/seedForecasts.js
// import cron from 'node-cron'
import { MongoClient } from 'mongodb'
import SFTPClient from 'ssh2-sftp-client'
import fs from 'fs'
import dayjs from 'dayjs'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import xml2js from 'xml2js'
import utc from 'dayjs/plugin/utc.js'
dayjs.extend(utc)

const logger = createLogger()
const MONGO_URI = config.get('mongo')
async function run() {
  logger.info('[Seeder] Running MetOffice forecast seed script...')

  const client = new MongoClient(MONGO_URI.uri)
  const today = dayjs().startOf('day').toDate()
  // const filename = `MetOfficeDefraAQSites_${dayjs().format('YYYYMMDD')}.xml`
  const filename = `MetOfficeDefraAQSites_20250524.xml`
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
    const sftp = new SFTPClient()

    const config = {
      host: 'sftp22.sftp-defra-gov-uk.quatrix.it',
      port: 22,
      username: 'q2031671',
      privateKey: fs.readFileSync('C:/Users/486272/.ssh/met_office_rsa_v1') // Replace with correct path
    }
    await sftp.connect(config)
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

run()
