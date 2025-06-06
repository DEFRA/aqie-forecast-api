import { runForecastSyncJob } from './runForecastSyncJob.js'
import { getExpectedFileName } from '../helpers/utility.js'
import { pollUntilFound } from '../helpers/pollUntilFound.js'

jest.mock('../helpers/utility.js', () => ({
  getExpectedFileName: jest.fn(),
  sleep: jest.fn()
}))
jest.mock('../helpers/pollUntilFound.js', () => ({
  pollUntilFound: jest.fn()
}))
jest.mock('../helpers/connectSftpViaProxy.js', () => ({
  connectSftpThroughProxy: jest.fn()
}))
jest.mock('../helpers/parse-forecast-xml.js', () => ({
  parseForecastXml: jest.fn()
}))
jest.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn()
  })
}))

describe('runForecastSyncJob', () => {
  let mockServer, mockCollection

  beforeEach(() => {
    jest.clearAllMocks()

    mockCollection = {
      createIndex: jest.fn(),
      countDocuments: jest.fn()
    }

    mockServer = {
      db: {
        listCollections: jest.fn(),
        createCollection: jest.fn(),
        collection: jest.fn().mockResolvedValue(mockCollection)
      }
    }

    getExpectedFileName.mockReturnValue('forecast.xml')
  })

  it('should create collection and start polling if forecast does not exist', async () => {
    mockServer.db.listCollections.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([])
    })
    mockCollection.countDocuments.mockResolvedValue(0)

    await runForecastSyncJob(mockServer)

    expect(mockServer.db.createCollection).toHaveBeenCalledWith('forecasts')
    expect(mockCollection.createIndex).toHaveBeenCalledWith(
      { name: 1 },
      { unique: true }
    )
    expect(pollUntilFound).toHaveBeenCalled()
  })

  it('should skip collection creation if it already exists', async () => {
    mockServer.db.listCollections.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([{ name: 'forecasts' }])
    })
    mockCollection.countDocuments.mockResolvedValue(0)

    await runForecastSyncJob(mockServer)

    expect(mockServer.db.createCollection).not.toHaveBeenCalled()
    expect(pollUntilFound).toHaveBeenCalled()
  })

  it('should skip polling if forecast already exists for today', async () => {
    mockServer.db.listCollections.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([{ name: 'forecasts' }])
    })
    mockCollection.countDocuments.mockResolvedValue(1)

    await runForecastSyncJob(mockServer)

    expect(pollUntilFound).not.toHaveBeenCalled()
  })

  it('should log error if index creation fails but continue', async () => {
    mockServer.db.listCollections.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([{ name: 'forecasts' }])
    })
    mockCollection.countDocuments.mockResolvedValue(0)
    mockCollection.createIndex.mockRejectedValue(new Error('Index error'))

    await runForecastSyncJob(mockServer)

    expect(pollUntilFound).toHaveBeenCalled()
  })

  it('should throw and log error if polling fails', async () => {
    mockServer.db.listCollections.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([{ name: 'forecasts' }])
    })
    mockCollection.countDocuments.mockResolvedValue(0)
    pollUntilFound.mockRejectedValue(new Error('Polling failed'))

    await expect(runForecastSyncJob(mockServer)).rejects.toThrow(
      'Polling failed'
    )
  })

  it('should throw and log error if DB fails', async () => {
    mockServer.db.listCollections.mockImplementation(() => {
      throw new Error('DB failure')
    })

    await expect(runForecastSyncJob(mockServer)).rejects.toThrow('DB failure')
  })
})
