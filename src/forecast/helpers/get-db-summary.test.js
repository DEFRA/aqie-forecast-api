import { getForecastSummaryFromDB } from './get-db-summary.js'

describe('getForecastSummaryFromDB', () => {
  let mockDb, mockCollection

  beforeEach(() => {
    mockCollection = {
      findOne: jest.fn()
    }
    mockDb = {
      collection: jest.fn().mockReturnValue(mockCollection)
    }
  })

  it('should return summary from the database', async () => {
    const summary = { today: 'Sunny', tomorrow: 'Rainy' }
    mockCollection.findOne.mockResolvedValue(summary)
    const result = await getForecastSummaryFromDB(mockDb)
    expect(result).toBe(summary)
    expect(mockDb.collection).toHaveBeenCalled()
    expect(mockCollection.findOne).toHaveBeenCalled()
  })

  it('should return null if no summary found', async () => {
    mockCollection.findOne.mockResolvedValue(null)
    const result = await getForecastSummaryFromDB(mockDb)
    expect(result).toBeNull()
  })

  it('should throw error if db.collection throws', async () => {
    mockDb.collection.mockImplementation(() => {
      throw new Error('DB error')
    })
    await expect(getForecastSummaryFromDB(mockDb)).rejects.toThrow('DB error')
  })

  it('should throw error if findOne throws', async () => {
    mockCollection.findOne.mockImplementation(() => {
      throw new Error('findOne error')
    })
    await expect(getForecastSummaryFromDB(mockDb)).rejects.toThrow(
      'findOne error'
    )
  })
})
