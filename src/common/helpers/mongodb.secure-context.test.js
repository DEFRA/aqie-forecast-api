// Unit test that mocks the mongodb driver so we can assert the plugin passes a
// secureContext to MongoClient.connect when the server provides one. The
// integration test in mongodb.test.js covers the no-secure-context path.
import { MongoClient } from 'mongodb'
import { mongoDb } from './mongodb.js'

jest.mock('mongodb', () => ({
  MongoClient: { connect: jest.fn() }
}))
jest.mock('mongo-locks', () => ({
  LockManager: jest.fn().mockImplementation(() => ({}))
}))

describe('mongoDb plugin secure context', () => {
  it('passes secureContext to MongoClient.connect when the server has one', async () => {
    const mockCollection = { createIndex: jest.fn().mockResolvedValue() }
    const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) }
    const mockClient = {
      db: jest.fn().mockReturnValue(mockDb),
      close: jest.fn().mockResolvedValue()
    }
    MongoClient.connect.mockResolvedValue(mockClient)

    const eventHandlers = {}
    const fakeSecureContext = { context: 'secure' }
    const server = {
      logger: { info: jest.fn() },
      secureContext: fakeSecureContext,
      decorate: jest.fn(),
      events: {
        on: jest.fn((event, cb) => {
          eventHandlers[event] = cb
        })
      }
    }

    await mongoDb.plugin.register(server, {
      mongoUri: 'mongodb://localhost:27017',
      databaseName: 'test-db',
      retryWrites: false,
      readPreference: 'secondary'
    })

    expect(MongoClient.connect).toHaveBeenCalledWith(
      'mongodb://localhost:27017',
      expect.objectContaining({
        retryWrites: false,
        readPreference: 'secondary',
        secureContext: fakeSecureContext
      })
    )

    // Invoke the `request` decorator getters so their bodies are exercised
    const requestDecorators = server.decorate.mock.calls.filter(
      ([target]) => target === 'request'
    )
    expect(requestDecorators).toHaveLength(2)
    expect(requestDecorators.map(([, , getter]) => getter())).toEqual([
      mockDb,
      expect.any(Object)
    ])

    // Exercise the registered stop handler for completeness
    await eventHandlers.stop()
    expect(mockClient.close).toHaveBeenCalledWith(true)
  })
})
