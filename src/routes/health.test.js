import { Server } from '@hapi/hapi'
import { health } from './health.js'

describe('Health Route', () => {
  let server

  beforeAll(async () => {
    server = new Server()
    server.route(health)
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('GET /health should return 200 and success message', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health'
    })

    expect(response.statusCode).toBe(200)
    expect(response.result).toEqual({ message: 'success' })
  })
})
