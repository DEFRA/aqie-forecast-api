/* eslint-disable */
jest.mock('../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn()
  })
}))
import { forecastController } from './forecastController.js'
import { getForecastsFromDB } from './helpers/get-db-forecasts.js'
import { config } from '../config.js'
jest.mock('./helpers/get-db-forecasts.js', () => ({
  getForecastsFromDB: jest.fn()
}))

jest.mock('../config.js', () => ({
  config: {
    get: jest.fn()
  }
}))

describe('forecastController.handler', () => {
  const mockForecasts = [
    { id: 1, weather: 'sunny' },
    { id: 2, weather: 'cloudy' }
  ]

  const mockRequest = { db: {} }

  const mockResponseToolkit = {
    response: jest.fn().mockReturnThis(),
    code: jest.fn().mockReturnThis(),
    header: jest.fn().mockReturnThis()
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return forecasts with 200 status and correct headers', async () => {
    getForecastsFromDB.mockResolvedValue(mockForecasts)
    config.get.mockReturnValue('http://localhost:3000')

    const result = await forecastController.handler(
      mockRequest,
      mockResponseToolkit
    )

    expect(getForecastsFromDB).toHaveBeenCalledWith(mockRequest.db)
    expect(config.get).toHaveBeenCalledWith('allowOriginUrl')
    expect(mockResponseToolkit.response).toHaveBeenCalledWith({
      message: 'success',
      forecasts: mockForecasts
    })
    expect(mockResponseToolkit.code).toHaveBeenCalledWith(200)
    expect(mockResponseToolkit.header).toHaveBeenCalledWith(
      'Access-Control-Allow-Origin',
      'http://localhost:3000'
    )
    expect(result).toBe(mockResponseToolkit)
  })

  it('should handle empty forecasts array', async () => {
    getForecastsFromDB.mockResolvedValue([])
    config.get.mockReturnValue('*')

    const result = await forecastController.handler(
      mockRequest,
      mockResponseToolkit
    )

    expect(mockResponseToolkit.response).toHaveBeenCalledWith({
      message: 'success',
      forecasts: []
    })
    expect(mockResponseToolkit.code).toHaveBeenCalledWith(200)
    expect(mockResponseToolkit.header).toHaveBeenCalledWith(
      'Access-Control-Allow-Origin',
      '*'
    )
    expect(result).toBe(mockResponseToolkit)
  })

  it('should throw error if getForecastsFromDB fails', async () => {
    getForecastsFromDB.mockRejectedValue(new Error('DB error'))

    await expect(
      forecastController.handler(mockRequest, mockResponseToolkit)
    ).rejects.toThrow('DB error')
  })
})
