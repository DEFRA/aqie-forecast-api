import SFTPClient from 'ssh2-sftp-client'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { Buffer } from 'buffer'
import fs from 'fs'
import { URL } from 'url'
import http from 'http'
import https from 'https'
import { PROXY_PORT, SFTP_HOST, SFTP_PORT, SUCCESS_CODE } from './constant.js'
const logger = createLogger()

/**
 * Creates an SFTP client via CDP proxy and returns a connected SFTP instance.
 */
async function connectSftpThroughProxy() {
  const proxyUrl = new URL(config.get('httpProxy'))
  const proxyHost = proxyUrl.hostname
  const proxyPort = proxyUrl.port || PROXY_PORT
  logger.info(`port::: ${proxyPort}`)

  logger.info(
    `[Proxy Debug] CONNECTING to ${SFTP_HOST}:${SFTP_PORT} via proxyurl ${proxyUrl} ${proxyHost}:${proxyPort}`
  )
  const proxyOptions = {
    host: proxyHost,
    port: proxyPort,
    method: 'CONNECT',
    path: `${SFTP_HOST}:${SFTP_PORT}`,
    headers: {
      Host: `${SFTP_HOST}:${SFTP_PORT}`
    }
  }
  const privateKeyBase64 = config.get('sftpPrivateKey')
  const privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf-8')

  const proxyModule = proxyUrl.protocol.startsWith('https') ? https : http
  logger.info(`proxyModule::: ${JSON.stringify(proxyModule)}`)

  return new Promise((resolve, reject) => {
    logger.info(`inside Promise`)
    const req = proxyModule.request(proxyOptions)
    logger.info(`Before REQUEST:: ${JSON.stringify(req)}`)
    req.path = `${SFTP_HOST}:${SFTP_PORT}`
    logger.info(`After REQUEST:: ${JSON.stringify(req)}`)
    req.on('connect', async (res, socket) => {
      logger.info(`SOCKET:: ${JSON.stringify(socket)}`)
      logger.info(`RESPONSE:: ${JSON.stringify(res)}`)
      if (res.statusCode !== SUCCESS_CODE) {
        reject(
          new Error(
            `Proxy CONNECT failed: ${JSON.stringify(res)} : ${res.statusCode}`
          )
        )
        return
      }
      logger.info('[Proxy Debug] Tunnel established — starting SSH connection')
      const sftp = new SFTPClient()
      try {
        await sftp.connect({
          sock: socket,
          host: SFTP_HOST,
          port: SFTP_PORT,
          username: 'q2031671',
          privateKey
        })
        logger.info('[SFTP] Connection established via proxy')
        resolve({ sftp }) // Return SFTP client only
      } catch (err) {
        logger.error(`[SFTP Connect Error], ${JSON.stringify(err)}`)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    req.on('error', (err) => {
      logger.error(
        `Failed to create socket or establish SFTP connection: ${JSON.stringify(err)}`
      )
      reject(err instanceof Error ? err : new Error(String(err)))
    })
    req.end()
  })
}

async function connectLocalSftp() {
  logger.info(`inside local connectLocalSftp`)
  logger.info(`logger.gobalhttp:: ${JSON.stringify(http.globalAgent)}`)
  const sftp = new SFTPClient()
  const localConfig = {
    host: 'sftp22.sftp-defra-gov-uk.quatrix.it',
    port: 22,
    username: 'q2031671',
    privateKey: fs.readFileSync('C:/Users/486272/.ssh/met_office_rsa_v1') // Replace with correct path
  }
  try {
    await sftp.connect(localConfig)
    logger.info(`successfully established connection to sftp server`)
    return { sftp }
  } catch (err) {
    logger.error(`[Local SFTP Connect Error] ${JSON.stringify(err)}`)
    throw err instanceof Error ? err : new Error(String(err))
  }
}

export { connectLocalSftp, connectSftpThroughProxy }
