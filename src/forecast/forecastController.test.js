/* eslint-disable */
jest.mock('../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn()
  })
}))
import { forecastController } from './forecastController.js'
import { getForecastsFromDB } from './helpers/get-db-forecasts.js'
import { getForecastSummaryFromDB } from './helpers/get-db-summary.js'
import { config } from '../config.js'

jest.mock('./helpers/get-db-forecasts.js', () => ({
  getForecastsFromDB: jest.fn()
}))
jest.mock('./helpers/get-db-summary.js', () => ({
  getForecastSummaryFromDB: jest.fn()
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
  const mockSummary = { type: 'latest', summary: 'Good air quality' }

  const mockDb = {
    collection: jest.fn().mockReturnValue({
      findOne: jest.fn().mockResolvedValue(mockSummary)
    })
  }

  const mockRequest = { db: mockDb }

  const mockResponseToolkit = {
    response: jest.fn().mockReturnThis(),
    code: jest.fn().mockReturnThis(),
    header: jest.fn().mockReturnThis()
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return forecasts and summary with 200 status and correct headers', async () => {
    getForecastsFromDB.mockResolvedValue(mockForecasts)
    getForecastSummaryFromDB.mockResolvedValue(mockSummary)
    config.get.mockReturnValue('http://localhost:3000')

    const result = await forecastController.handler(
      mockRequest,
      mockResponseToolkit
    )

    expect(getForecastsFromDB).toHaveBeenCalledWith(mockRequest.db)
    expect(getForecastSummaryFromDB).toHaveBeenCalledWith(mockRequest.db)
    expect(config.get).toHaveBeenCalledWith('allowOriginUrl')
    expect(mockResponseToolkit.response).toHaveBeenCalledWith({
      message: 'success',
      forecasts: mockForecasts,
      'forecast-summary': mockSummary // <-- updated property name
    })
    expect(mockResponseToolkit.code).toHaveBeenCalledWith(200)
    expect(mockResponseToolkit.header).toHaveBeenCalledWith(
      'Access-Control-Allow-Origin',
      'http://localhost:3000'
    )
    expect(result).toBe(mockResponseToolkit)
  })

  it('should handle empty forecasts array and summary', async () => {
    getForecastsFromDB.mockResolvedValue([])
    getForecastSummaryFromDB.mockResolvedValue(null)
    config.get.mockReturnValue('*')

    const result = await forecastController.handler(
      mockRequest,
      mockResponseToolkit
    )

    expect(mockResponseToolkit.response).toHaveBeenCalledWith({
      message: 'success',
      forecasts: [],
      'forecast-summary': null // <-- updated property name
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

  it('should throw error if getForecastSummaryFromDB fails', async () => {
    getForecastsFromDB.mockResolvedValue(mockForecasts)
    getForecastSummaryFromDB.mockRejectedValue(new Error('Summary DB error'))

    await expect(
      forecastController.handler(mockRequest, mockResponseToolkit)
    ).rejects.toThrow('Summary DB error')
  })
})
