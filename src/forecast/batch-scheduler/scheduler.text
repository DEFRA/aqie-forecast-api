/* eslint-disable */
import cron from 'node-cron'
import { MongoClient } from 'mongodb'
import SFTPClient from 'ssh2-sftp-client'
// import fs from 'fs'
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
const MONGODB_URI = config.get('mongo')
const DB_NAME = 'aqie-forecast-api'
const COLLECTION_NAME = 'forecasts'

const remoteDir = '/Incoming Shares/AQIE/MetOffice/'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const getExpectedFileName = () => {
  const today = dayjs().format('YYYYMMDD')
  return `MetOfficeDefraAQSites_${today}.xml` //MetOfficeDefraAQSites_20250425.xml
  // return `MetOfficeDefraAQSites_20250525.xml`
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
    // const updatedDate = baseDate.toDate()
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

async function connectSftpThroughProxy() {
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
        logger.error(`[SFTP Connect Error], ${err}`)
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
const runForecastSyncJob = async () => {
  logger.info('[Scheduler] Running Met Office forecast sync...')

  const client = new MongoClient(MONGODB_URI.uri)
  const filename = getExpectedFileName()

  try {
    await client.connect()
    const db = client.db(DB_NAME)

    // Create collection if it doesn't exist
    const collections = await db
      .listCollections({ name: COLLECTION_NAME })
      .toArray()
    logger.info(`collection length ${collections.length}`)
    if (collections.length === 0) {
      await db.createCollection(COLLECTION_NAME)
      logger.info(`[MongoDB] Created collection '${COLLECTION_NAME}'`)
    }

    const forecastsCol = db.collection(COLLECTION_NAME)

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

    const pollUntilFound = async () => {
      while (true) {
        logger.info(`[SFTP] Connecting to check for file ${filename}`)

        try {
          // const sftp = await connectSftpThroughProxy()
          const sftp = new SFTPClient()

          const config = {
            host: 'sftp22.sftp-defra-gov-uk.quatrix.it',
            port: 22,
            username: 'q2031671',
            privateKey: fs.readFileSync(
              'C:/Users/486272/.ssh/met_office_rsa_v1'
            ) // Replace with correct path
          }
          await sftp.connect(config)
          logger.info('inside connection')
          const files = await sftp.list(remoteDir)
          logger.info(`[SFTP] Files List ${files} found.`)
          const fileFound = files.find((files) => files.name === filename)
          logger.info(`[SFTP] File Match ${fileFound} found.`)
          if (fileFound) {
            logger.info(`[SFTP] File ${filename} found. Fetching content...`)
            const fileContent = await sftp.get(`${remoteDir}${filename}`)
            logger.info(`FILE CONTENT FROM SERVER:: ${fileContent}`)
            await sftp.end()

            const parsedForecasts = await parseForecastXml(
              fileContent.toString()
            )
            logger.info(
              `PARSED XML FILE CONTENT :: ${JSON.stringify(parsedForecasts[0], null, 2)}`
            )
            logger.info(typeof parsedForecasts[0].updated)
            logger.info(parsedForecasts[0].updated)
            // await forecastsCol.insertMany(parsedForecasts)
            const bulkOps = parsedForecasts.map((forecast) => ({
              updateOne: {
                filter: { name: forecast.name },
                update: { $set: forecast },
                upsert: true // if not found, insert it
              }
            }))

            await forecastsCol.bulkWrite(bulkOps)

            logger.info(
              `[DB] Forecasts inserted successfully for ${parsedForecasts.length} locations.`
            )
            break
          } else {
            logger.info(
              `[SFTP] File ${filename} not found. Retrying in 15 mins.`
            )
            await sftp.end()
            await sleep(15 * 60 * 1000)
          }
        } catch (err) {
          logger.error(`[Error] While checking SFTP: ${err.message}`)
          logger.error(
            `JSON [Error] While checking SFTP: ${JSON.stringify(err)}`
          )
          logger.info('[Retry] Waiting 15 mins before next attempt.')
          await sleep(15 * 60 * 1000)
        }
      }
    }

    await pollUntilFound()
  } catch (error) {
    logger.error(`[Scheduler Error] ${error.message}`)
    logger.error(`JSON [Scheduler Error] ${JSON.stringify(error)}`)
  } finally {
    await client.close()
  }
}

// Schedule it to run daily at 5:00 AM
cron.schedule('44 1 * * *', async () => {
  await runForecastSyncJob()
})
