/* eslint-disable */
jest.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn()
  })
}))
import {
  connectSftpThroughProxy,
  connectLocalSftp
} from './connectSftpViaProxy.js'
import SFTPClient from 'ssh2-sftp-client'
import fs from 'fs'
import http from 'http'
import https from 'https'
import { config } from '../../config.js'

jest.mock('ssh2-sftp-client')
jest.mock('fs')
jest.mock('http')
jest.mock('https')
jest.mock('../../config.js', () => ({
  config: {
    get: jest.fn()
  }
}))

describe('connectSftpThroughProxy', () => {
  let mockSocket, mockSftpInstance

  beforeEach(() => {
    mockSocket = {}
    mockSftpInstance = {
      connect: jest.fn().mockResolvedValue()
    }
    SFTPClient.mockImplementation(() => mockSftpInstance)
  })

  it('should connect successfully via HTTP proxy', async () => {
    config.get.mockImplementation((key) => {
      if (key === 'httpProxy') return 'http://proxy.example.com:8080'
      if (key === 'sftpPrivateKey')
        return Buffer.from('PRIVATE_KEY').toString('base64')
    })

    const req = {
      on: jest.fn((event, cb) => {
        if (event === 'connect') {
          cb({ statusCode: 200 }, mockSocket)
        }
        return req
      }),
      end: jest.fn()
    }

    http.request.mockReturnValue(req)

    const result = await connectSftpThroughProxy()
    expect(result).toHaveProperty('sftp')
    expect(mockSftpInstance.connect).toHaveBeenCalled()
  })

  it('should fail if proxy returns non-200', async () => {
    config.get
      .mockReturnValueOnce('http://proxy.example.com:8080')
      .mockReturnValueOnce(Buffer.from('PRIVATE_KEY').toString('base64'))

    const req = {
      on: jest.fn((event, cb) => {
        if (event === 'connect') {
          cb({ statusCode: 403 }, mockSocket)
        }
        return req
      }),
      end: jest.fn()
    }

    http.request.mockReturnValue(req)

    await expect(connectSftpThroughProxy()).rejects.toThrow(
      'Proxy CONNECT failed'
    )
  })

  it('should fail if proxy request errors out', async () => {
    config.get
      .mockReturnValueOnce('http://proxy.example.com:8080')
      .mockReturnValueOnce(Buffer.from('PRIVATE_KEY').toString('base64'))

    const req = {
      on: jest.fn((event, cb) => {
        if (event === 'error') {
          cb(new Error('Proxy error'))
        }
        return req
      }),
      end: jest.fn()
    }

    http.request.mockReturnValue(req)

    await expect(connectSftpThroughProxy()).rejects.toThrow('Proxy error')
  })

  it('should fail if SFTP connection fails', async () => {
    config.get
      .mockReturnValueOnce('http://proxy.example.com:8080')
      .mockReturnValueOnce(Buffer.from('PRIVATE_KEY').toString('base64'))

    mockSftpInstance.connect.mockRejectedValueOnce(
      new Error('SFTP connect failed')
    )

    const req = {
      on: jest.fn((event, cb) => {
        if (event === 'connect') {
          cb({ statusCode: 200 }, mockSocket)
        }
        return req
      }),
      end: jest.fn()
    }

    http.request.mockReturnValue(req)

    await expect(connectSftpThroughProxy()).rejects.toThrow(
      'SFTP connect failed'
    )
  })
})

describe('connectLocalSftp', () => {
  let mockSftpInstance

  beforeEach(() => {
    mockSftpInstance = {
      connect: jest.fn().mockResolvedValue()
    }
    SFTPClient.mockImplementation(() => mockSftpInstance)
  })

  it('should connect successfully to local SFTP', async () => {
    fs.readFileSync.mockReturnValue('PRIVATE_KEY')

    const result = await connectLocalSftp()
    expect(result).toHaveProperty('sftp')
    expect(mockSftpInstance.connect).toHaveBeenCalled()
  })

  it('should fail if private key file is missing', async () => {
    fs.readFileSync.mockImplementation(() => {
      throw new Error('File not found')
    })

    await expect(connectLocalSftp()).rejects.toThrow('File not found')
  })

  it('should fail if SFTP connection fails', async () => {
    fs.readFileSync.mockReturnValue('PRIVATE_KEY')
    mockSftpInstance.connect.mockRejectedValueOnce(new Error('SFTP error'))

    await expect(connectLocalSftp()).rejects.toThrow('SFTP error')
  })
})
