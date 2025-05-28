/* eslint-disable */
import { config } from '../config.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import {
  connectSftpThroughProxy,
  connectLocalSftp
} from './connectSftpViaProxy.js'
import xml2js from 'xml2js'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'

dayjs.extend(utc)
const logger = createLogger()
const testController = {
  handler: async (request, h) => {
    logger.info('inside test controller')
    const allowOriginUrl = config.get('allowOriginUrl')
    //const { filename } = request.params
    const filename = 'MetOfficeDefraAQSites_20250527.xml'
    logger.info(`filename:: ${filename}`)
    const remoteDir = '/Incoming Shares/AQIE/MetOffice/'

    try {
      logger.info('Before Connection')
      const { sftp } = await connectSftpThroughProxy()
      // const { sftp } = await connectLocalSftp()
      logger.info('After Connection')

      // List files in the remote directory
      const fileList = await sftp.list(remoteDir)
      console.log(
        '📂 Files in directory:',
        fileList.map((f) => f.name)
      )
      // Filter file by exact name
      const match = fileList.find((files) => files.name === filename)
      console.log('🔍 Match found:', match)

      if (!match) {
        await sftp.end()
        return h
          .response({
            success: false,
            message: `File ${filename} not found`
          })
          .code(404)
      }

      // If found, get the file content Download file content into buffer
      const xmlBuffer = await sftp.get(`${remoteDir}${filename}`)
      const xmlContent = xmlBuffer.toString('utf8')

      const forecastDocs = await parseForecastXml(xmlContent)
      await sftp.end()
      return h
        .response(forecastDocs)
        .type('application/json') // or 'text/xml'
        .code(200)
        .header('Access-Control-Allow-Origin', allowOriginUrl)
    } catch (error) {
      logger.error(`Error Message listing file: ${error.message}`)
      logger.error(`'Error listing file:' ${error}`)
      logger.error(`'JSON Error listing file:' ${JSON.stringify(error)}`)
      return h.response({ success: false, error: error.message }).code(500)
    }
  }
}

const parseForecastXml = async (xmlString) => {
  logger.info(`inside parseForecastXml function`)
  try {
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
  } catch (err) {
    logger.error(`'[XML Parse Error]', ${err}`)
    throw err
  }
}

export { testController }
