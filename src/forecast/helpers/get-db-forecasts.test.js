import { getForecastsFromDB } from './get-db-forecasts.js'

describe('getForecastsFromDB', () => {
  it('should return an array of forecasts from the database', async () => {
    const mockForecasts = [
      { date: '2025-06-06', temperature: 25 },
      { date: '2025-06-07', temperature: 27 }
    ]

    const mockToArray = jest.fn().mockResolvedValue(mockForecasts)
    const mockFind = jest.fn().mockReturnValue({ toArray: mockToArray })
    const mockCollection = jest.fn().mockReturnValue({ find: mockFind })
    const mockDb = { collection: mockCollection }

    const result = await getForecastsFromDB(mockDb)

    expect(mockDb.collection).toHaveBeenCalledWith('forecasts')
    expect(mockFind).toHaveBeenCalledWith({}, { projection: { _id: 0 } })
    expect(result).toEqual(mockForecasts)
  })

  it('should return an empty array if no forecasts are found', async () => {
    const mockToArray = jest.fn().mockResolvedValue([])
    const mockFind = jest.fn().mockReturnValue({ toArray: mockToArray })
    const mockCollection = jest.fn().mockReturnValue({ find: mockFind })
    const mockDb = { collection: mockCollection }

    const result = await getForecastsFromDB(mockDb)

    expect(result).toEqual([])
  })

  it('should throw an error if db.collection throws', async () => {
    const mockDb = {
      collection: jest.fn(() => {
        throw new Error('DB error')
      })
    }

    await expect(getForecastsFromDB(mockDb)).rejects.toThrow('DB error')
  })
})
