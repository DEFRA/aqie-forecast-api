import { Db, MongoClient } from 'mongodb'
import { LockManager } from 'mongo-locks'
import { createServer } from '../../server.js'

let mongoAvailable = true
beforeAll(async () => {
  try {
    const client = await MongoClient.connect(
      process.env.MONGO_URI || 'mongodb://localhost:27017',
      { serverSelectionTimeoutMS: 5000 }
    )
    await client.close()
  } catch (e) {
    mongoAvailable = false
    console.warn('MongoDB not available, skipping #mongoDb tests.')
  }
})

const maybeDescribe = mongoAvailable ? describe : describe.skip
maybeDescribe('#mongoDb', () => {
  let server

  describe('Set up', () => {
    beforeAll(async () => {
      try {
        console.log('Creating server...')
        server = await createServer()
        console.log('Server created:', !!server)
        console.log('Initializing server...')
        await server.initialize()
        console.log('Server initialized.')
      } catch (err) {
        console.error('Error in beforeAll:', err)
        throw err
      }
    }, 30000)

    afterAll(async () => {
      if (server && server.locker && typeof server.locker.stop === 'function') {
        await server.locker.stop()
      }
      if (server && typeof server.stop === 'function') {
        await server.stop({ timeout: 0 })
      }
    })

    test.skip('Server should have expected MongoDb decorators', () => {
      expect(server.db).toBeInstanceOf(Db)
      expect(server.mongoClient).toBeInstanceOf(MongoClient)
      expect(server.locker).toBeInstanceOf(LockManager)
    })

    test.skip('MongoDb should have expected database name', () => {
      expect(server.db.databaseName).toBe('aqie-forecast-api')
    })

    test.skip('MongoDb should have expected namespace', () => {
      expect(server.db.namespace).toBe('aqie-forecast-api')
    })
  })

  describe('Shut down', () => {
    // beforeAll(async () => {
    //   server = await createServer()
    //   await server.initialize()
    // })

    test.skip('Should close Mongo client on server stop', async () => {
      const closeSpy = jest.spyOn(server.mongoClient, 'close')
      await server.stop({ timeout: 0 })

      expect(closeSpy).toHaveBeenCalledWith(true)
    })
  })
})
