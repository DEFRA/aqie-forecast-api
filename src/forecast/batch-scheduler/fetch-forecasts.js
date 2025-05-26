import SFTPClient from 'ssh2-sftp-client'
// import fs from 'fs';
import { Buffer } from 'buffer'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import { config } from '../../config.js'
import { URL } from 'url'
import http from 'http'
import https from 'https'
import { createLogger } from '../../common/helpers/logging/logger.js'
import xml2js from 'xml2js'

dayjs.extend(utc)
const logger = createLogger()
const COLLECTION_NAME = 'forecasts'
const filename = `MetOfficeDefraAQSites_20250524.xml`
const remotePath = `/Incoming Shares/AQIE/MetOffice/${filename}`

export const fetchForecast = async () => {
  try {
    const sftp = await connectSftpThroughProxy()
    const xmlBuffer = await sftp.get(remotePath)
    const xmlContent = xmlBuffer.toString('utf8')

    const parsedData = await parseForecastXml(xmlContent)
    sftp.end()
    return parsedData
  } catch (err) {
    logger.error(`[Seeder] Error: ${JSON.stringify(err)}`, err)
  }
}

async function connectSftpThroughProxy() {
  logger.info(`inside connectSftpThroughProxy function`)
  const proxyUrl = new URL(config.get('httpProxy'))
  const proxyHost = proxyUrl.hostname
  const proxyPort = proxyUrl.port || 3128

  const sftpHost = 'sftp22.sftp-defra-gov-uk.quatrix.it'
  const sftpPort = 22
  const username = 'q2031671'

  // const privateKey = fs.readFileSync('C:/Users/486272/.ssh/met_office_rsa_v1')
  const privateKeyBase64 = config.get('sftpPrivateKey')
  const privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf-8')

  logger.info(
    `[Proxy Debug] CONNECTING to ${sftpHost}:${sftpPort} via proxy ${proxyHost}:${proxyPort}`
  )

  const proxyOptions = {
    host: proxyHost,
    port: proxyPort,
    method: 'CONNECT',
    path: `${sftpHost}:${sftpPort}`,
    headers: {
      Host: `${sftpHost}:${sftpPort}`
    }
  }

  const proxyModule = proxyUrl.protocol.startsWith('https') ? https : http

  return new Promise((resolve, reject) => {
    const req = proxyModule.request(proxyOptions)
    logger.info(`REQUEST:: ${JSON.stringify(req)}`)
    req.on('connect', async (res, socket) => {
      logger.info(`SOCKET:: ${JSON.stringify(socket)}`)
      if (res.statusCode !== 200) {
        logger.error(`[Proxy Error] Failed with status: ${res.statusCode}`)
        return reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`))
      }

      logger.info('[Proxy Debug] Tunnel established. Connecting to SFTP...')

      const sftp = new SFTPClient()

      try {
        await sftp.connect({
          sock: socket,
          host: sftpHost,
          port: sftpPort,
          username,
          privateKey
        })

        logger.info('[SFTP] Connection established via proxy')
        resolve(sftp) // Return SFTP client only
      } catch (err) {
        logger.error(`[SFTP Connect Error], ${JSON.stringify(err)}`)
        reject(err)
      }
    })

    req.on('error', (err) => {
      logger.error(`[Proxy Request Error], ${JSON.stringify(err)}`)
      reject(err)
    })

    req.end()
  })
}

const parseForecastXml = async (xmlString) => {
  logger.info(`inside parseForecastXml function`)
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

export const saveForecasts = async (server, forecasts) => {
  try {
    logger.info(`inside saveForecasts function`)
    // Create collection if it doesn't exist
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
    if (exists) {
      logger.info('[DB] Forecast already updated for today. Exiting.')
      return
    }
    await forecastsCol.insertMany(forecasts)
    logger.info(`[Seeder] Inserted ${forecasts.length} forecast records.`)
  } catch (error) {
    logger.info(`forecasts update error: ${JSON.stringify(error)}`)
  }
}
