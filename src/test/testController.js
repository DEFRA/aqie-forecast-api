/* eslint-disable */
import { config } from '../config.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { connectSftpThroughProxy } from './connectSftpViaProxy.js'
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
      const { sftp, conn } = await connectSftpThroughProxy()
      logger.info('After Connection')

      // List files in the remote directory
      const fileList = await new Promise((resolve, reject) => {
        sftp.readdir(remoteDir, (err, list) => {
          if (err) return reject(err)
          resolve(list)
        })
      })
      logger.info(
        'Files in directory:',
        fileList.map((f) => f.filename)
      )

      // Filter file by exact name
      const match = fileList.find((file) => file.filename === filename)
      logger.info(`'Match found:', match`)

      if (!match) {
        await conn.end()
        return h
          .response({
            success: false,
            message: `File ${filename} not found`
          })
          .code(404)
      }

      // If found, get the file content and download it into a buffer
      const fileBuffer = await new Promise((resolve, reject) => {
        sftp.readFile(`${remoteDir}${filename}`, (err, buffer) => {
          if (err) return reject(err)
          resolve(buffer)
        })
      })
      await conn.end()

      return h
        .response(fileBuffer.toString())
        .type('application/xml') // or 'text/xml'
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

export { testController }
