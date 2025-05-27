// import SFTPClient from 'ssh2-sftp-client'
import { Client } from 'ssh2'
// import { ProxyAgent } from 'undici'
import { config } from '../config.js'
import { createLogger } from '../common/helpers/logging/logger.js'
import { Buffer } from 'buffer'
// import fs from 'fs'
// import { URL } from 'url'
import http from 'http'
// import https from 'https'
const logger = createLogger()
/**
 * Creates an SFTP client via CDP proxy and returns a connected SFTP instance.
 */

export async function connectSftpThroughProxy() {
  // const proxyUrl = new URL(config.get('httpProxy'))
  const proxyHost = 'localhost'
  const proxyPort = 80
  logger.info(`port::: ${proxyPort}`)
  const sftpHost = 'sftp22.sftp-defra-gov-uk.quatrix.it'
  const sftpPort = 22

  logger.info(
    `[Proxy Debug] CONNECTING to ${sftpHost}:${sftpPort} via proxyurl ${proxyHost}:${proxyPort}`
  )
  const proxyOptions = {
    method: 'CONNECT',
    path: `sftp22.sftp-defra-gov-uk.quatrix.it:22`,
    headers: {
      Host: `sftp22.sftp-defra-gov-uk.quatrix.it:22`
      // 'Proxy-Authorization': proxyAuthHeader
    }
    // rejectUnauthorized: false // Disable certificate validation
    // servername: proxyHost // this ensures the TLS cert matches the expected domain
  }

  // const privateKey = fs.readFileSync('C:/Users/486272/.ssh/met_office_rsa_v1')
  const privateKeyBase64 = config.get('sftpPrivateKey')
  const privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf-8')

  const proxyModule = http
  logger.info(`proxyModule::: ${JSON.stringify(proxyModule)}`)

  return new Promise((resolve, reject) => {
    logger.info(`inside Promise`)
    logger.info(`privateKey:: ${privateKey}`)
    const req = proxyModule.request(proxyOptions)
    logger.info(`REQUEST:: ${JSON.stringify(req)}`)
    req.on('connect', (res, socket) => {
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

      const conn = new Client()
      conn
        .on('ready', () => {
          logger.info('SFTP connection established successfully via proxy')
          conn.sftp((err, sftp) => {
            if (err) {
              logger.error(`Failed to initialize SFTP: ${JSON.stringify(err)}`)
              return reject(err)
            }
            resolve({ sftp, conn })
          })
        })
        .on('error', (err) => {
          logger.error(
            `Failed to establish SFTP connection: ${JSON.stringify(err)}`
          )
          reject(err)
        })
        .connect({
          sock: socket,
          host: sftpHost,
          port: sftpPort,
          username: 'q2031671',
          privateKey
        })
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
