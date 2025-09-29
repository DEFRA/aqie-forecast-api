import { runForecastSyncJob } from './runForecastSyncJob.js'
import {
  getExpectedFileName,
  getExpectedSummaryFileName
} from '../helpers/utility.js'
import { pollUntilFound } from '../helpers/pollUntilFound.js'

jest.mock('../helpers/utility.js', () => ({
  getExpectedFileName: jest.fn(),
  getExpectedSummaryFileName: jest.fn(), // <-- Added summary mock
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
      },
      locker: {
        lock: jest.fn().mockResolvedValue({
          free: jest.fn()
        })
      }
    }

    getExpectedFileName.mockReturnValue('forecast.xml')
    getExpectedSummaryFileName.mockReturnValue('summary.txt') // <-- Added summary mock return
  })

  afterEach(() => {
    jest.resetAllMocks()
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

  it('should wrap non-Error thrown during polling', async () => {
    mockServer.db.listCollections.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([{ name: 'forecasts' }])
    })
    mockCollection.countDocuments.mockResolvedValue(0)

    // Simulate a non-Error rejection
    pollUntilFound.mockRejectedValueOnce('non-error string')

    await expect(runForecastSyncJob(mockServer)).rejects.toThrow(
      'non-error string'
    )
  })

  it('should return early if lock is not acquired', async () => {
    const mockLock = null
    mockServer.locker = {
      lock: jest.fn().mockResolvedValue(mockLock)
    }

    await runForecastSyncJob(mockServer)

    expect(mockServer.locker.lock).toHaveBeenCalledWith('forecasts')
    expect(mockServer.db.listCollections).not.toHaveBeenCalled()
  })

  it('should release lock after successful execution', async () => {
    const mockFree = jest.fn()
    const mockLock = { free: mockFree }

    mockServer.locker = {
      lock: jest.fn().mockResolvedValue(mockLock)
    }

    mockServer.db.listCollections.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([])
    })
    mockCollection.countDocuments.mockResolvedValue(0)

    pollUntilFound.mockResolvedValue()

    await runForecastSyncJob(mockServer)

    expect(mockFree).toHaveBeenCalled()
  })

  it('should release lock even if an error is thrown', async () => {
    const mockFree = jest.fn()
    const mockLock = { free: mockFree }

    mockServer.locker = {
      lock: jest.fn().mockResolvedValue(mockLock)
    }

    mockServer.db.listCollections.mockImplementation(() => {
      throw new Error('DB failure')
    })

    await expect(runForecastSyncJob(mockServer)).rejects.toThrow('DB failure')
    expect(mockFree).toHaveBeenCalled()
  })

  it('should log an error if lock is not acquired', async () => {
    const mockError = jest.fn()
    const mockLogger = {
      info: jest.fn(),
      error: mockError
    }
    jest.mock('../../common/helpers/logging/logger.js', () => ({
      createLogger: () => mockLogger
    }))

    // Re-require the module to apply the new mock
    const { runForecastSyncJob } = await import('./runForecastSyncJob.js')

    mockServer.locker = {
      lock: jest.fn().mockResolvedValue(null)
    }

    await runForecastSyncJob(mockServer)

    expect(mockError).toHaveBeenCalledWith(
      'Failed to acquire lock for resource - forecasts or summary'
    )
  })
})
