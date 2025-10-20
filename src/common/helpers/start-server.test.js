import hapi from '@hapi/hapi'

const mockLoggerInfo = jest.fn()
const mockLoggerError = jest.fn()

const mockHapiLoggerInfo = jest.fn()
const mockHapiLoggerError = jest.fn()

jest.mock('hapi-pino', () => ({
  register: (server) => {
    server.decorate('server', 'logger', {
      info: mockHapiLoggerInfo,
      error: mockHapiLoggerError
    })
  },
  name: 'mock-hapi-pino'
}))
jest.mock('./logging/logger.js', () => ({
  createLogger: () => ({
    info: (...args) => mockLoggerInfo(...args),
    error: (...args) => mockLoggerError(...args)
  })
}))

let createServerSpy
let hapiServerSpy
let startServerImport
let createServerImport

describe('#startServer', () => {
  const PROCESS_ENV = process.env

  beforeAll(async () => {
    process.env = { ...PROCESS_ENV }
    process.env.PORT = '3098' // Set to obscure port to avoid conflicts

    createServerImport = await import('../../server.js')
    startServerImport = await import('./start-server.js')

    createServerSpy = jest.spyOn(createServerImport, 'createServer')
    hapiServerSpy = jest.spyOn(hapi, 'server')
  })

  afterAll(() => {
    process.env = PROCESS_ENV
  })

  describe('When server starts', () => {
    let server

    afterAll(async () => {
      if (server && typeof server.stop === 'function') {
        await server.stop({ timeout: 0 })
      }
    })

    afterEach(() => {
      jest.clearAllMocks()
    })

    test.skip('Should start up server as expected', async () => {
      // Ensure spies and imports are available in this scope
      if (!createServerSpy || !startServerImport) {
        createServerImport = await import('../../server.js')
        startServerImport = await import('./start-server.js')
        createServerSpy = jest.spyOn(createServerImport, 'createServer')
      }
      // Increased timeout for slow startup
      server = await startServerImport.startServer()

      expect(createServerSpy).toHaveBeenCalled()
      expect(hapiServerSpy).toHaveBeenCalled()
      expect(mockHapiLoggerInfo).toHaveBeenNthCalledWith(
        1,
        'Custom secure context is disabled'
      )
      expect(mockHapiLoggerInfo).toHaveBeenNthCalledWith(
        2,
        'Setting up MongoDb'
      )
    }, 15000)
  }, 15000)
})

describe('When server start fails', () => {
  beforeAll(async () => {
    if (!createServerSpy || !startServerImport) {
      createServerImport = await import('../../server.js')
      startServerImport = await import('./start-server.js')
      createServerSpy = jest.spyOn(createServerImport, 'createServer')
    }
    createServerSpy.mockRejectedValue(new Error('Server failed to start'))
  })

  test.skip('Should log failed startup message', async () => {
    await startServerImport.startServer()

    expect(mockLoggerInfo).toHaveBeenCalledWith('Server failed to start :(')
    expect(mockLoggerError).toHaveBeenCalledWith(
      Error('Server failed to start')
    )
  })
})
