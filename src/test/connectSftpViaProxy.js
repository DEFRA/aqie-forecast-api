import SFTPClient from 'ssh2-sftp-client'
// import { Client } from 'ssh2'
// import { ProxyAgent } from 'undici'
import { config } from '../config.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { Buffer } from 'buffer'
import fs from 'fs'
import { URL } from 'url'
import http from 'http'
import https from 'https'
const logger = createLogger()

/**
 * Creates an SFTP client via CDP proxy and returns a connected SFTP instance.
 */
async function connectSftpThroughProxy() {
  const proxyUrl = new URL(config.get('httpProxy'))
  const proxyHost = proxyUrl.hostname
  const proxyPort = proxyUrl.port || 3128
  logger.info(`port::: ${proxyPort}`)
  const sftpHost = 'sftp22.sftp-defra-gov-uk.quatrix.it'
  const sftpPort = 22

  logger.info(
    `[Proxy Debug] CONNECTING to ${sftpHost}:${sftpPort} via proxyurl ${proxyUrl} ${proxyHost}:${proxyPort}`
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
  const privateKeyBase64 = config.get('sftpPrivateKey')
  const privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf-8')

  const proxyModule = proxyUrl.protocol.startsWith('https') ? https : http
  logger.info(`proxyModule::: ${JSON.stringify(proxyModule)}`)

  return new Promise((resolve, reject) => {
    logger.info(`inside Promise`)
    logger.info(`privateKey:: ${privateKey}`)
    logger.info(`http.globalAgent:: ${http.globalAgent}`)
    const req = proxyModule.request(proxyOptions)
    logger.info(`Before REQUEST:: ${JSON.stringify(req)}`)
    req.path = `${sftpHost}:${sftpPort}`
    logger.info(`After REQUEST:: ${JSON.stringify(req)}`)
    req.on('connect', async (res, socket) => {
      logger.info(`SOCKET:: ${JSON.stringify(socket)}`)
      logger.info(`RESPONSE:: ${JSON.stringify(res)}`)
      if (res.statusCode !== 200) {
        return reject(
          new Error(
            `Proxy CONNECT failed: ${JSON.stringify(res)} : ${res.statusCode}`
          )
        )
      }
      logger.info('[Proxy Debug] Tunnel established — starting SSH connection')
      const sftp = new SFTPClient()
      try {
        await sftp.connect({
          sock: socket,
          host: sftpHost,
          port: sftpPort,
          username: 'q2031671',
          privateKey
        })
        logger.info('[SFTP] Connection established via proxy')
        resolve({ sftp }) // Return SFTP client only
      } catch (err) {
        logger.error(`[SFTP Connect Error], ${JSON.stringify(err)}`)
        reject(err)
      }
    })
    req.on('error', (err) => {
      logger.error(
        `Failed to create socket or establish SFTP connection: ${JSON.stringify(err)}`
      )
      reject(err)
    })
    req.end()
  })
}

async function connectLocalSftp() {
  logger.info(`inside local connectLocalSftp`)
  const sftp = new SFTPClient()
  const config = {
    host: 'sftp22.sftp-defra-gov-uk.quatrix.it',
    port: 22,
    username: 'q2031671',
    privateKey: fs.readFileSync('C:/Users/486272/.ssh/met_office_rsa_v1') // Replace with correct path
  }
  await sftp.connect(config)
  logger.info(`successfully established connection to sftp server`)
  return { sftp }
}

export { connectLocalSftp, connectSftpThroughProxy }
