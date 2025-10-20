/* eslint-disable */
jest.setTimeout(30000) // 30 seconds
import { runForecastSyncJob } from './runForecastSyncJob.js'
import { schedule } from 'node-cron'
import { seedForecastScheduler } from './seed-forecasts.js'

jest.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: jest.fn(() => mockLogger)
}))

// Shared mock logger instance
const mockLogger = {
  info: jest.fn(),
  error: jest.fn()
}

jest.mock('node-cron', () => ({
  schedule: jest.fn()
}))

jest.mock('./runForecastSyncJob.js', () => ({
  runForecastSyncJob: jest.fn()
}))

describe('seedForecastScheduler plugin', () => {
  let serverMock
  let cronCallback
  let stopMock

  beforeEach(() => {
    stopMock = jest.fn()
    serverMock = { ext: jest.fn() }

    schedule.mockImplementation((_, cb) => {
      cronCallback = cb
      return { stop: stopMock }
    })

    jest.clearAllMocks()
  })

  it.skip('should register and schedule the cron job', async () => {
    await seedForecastScheduler.plugin.register(serverMock)

    expect(schedule).toHaveBeenCalled()
    expect(serverMock.ext).toHaveBeenCalledWith(
      'onPostStop',
      expect.any(Function)
    )
    expect(mockLogger.info).toHaveBeenCalledWith('starting forecasts Scheduler')
  })

  it.skip('should call runForecastSyncJob when cron job is triggered', async () => {
    await seedForecastScheduler.plugin.register(serverMock)
    expect(typeof cronCallback).toBe('function')
    await cronCallback()
    expect(runForecastSyncJob).toHaveBeenCalled()
  })

  it.skip('should log and re-throw error if runForecastSyncJob throws an Error', async () => {
    const error = new Error('Sync failed')
    runForecastSyncJob.mockRejectedValueOnce(error)

    await seedForecastScheduler.plugin.register(serverMock)

    await expect(cronCallback()).rejects.toThrow('Sync failed')
    expect(mockLogger.error).toHaveBeenCalledWith(`[Cron Job Error]`, error)
  })

  it.skip('should wrap and re-throw non-Error thrown values from runForecastSyncJob', async () => {
    runForecastSyncJob.mockRejectedValueOnce('non-error string')

    await seedForecastScheduler.plugin.register(serverMock)

    await expect(cronCallback()).rejects.toThrow('non-error string')
    expect(mockLogger.error).toHaveBeenCalledWith(
      `[Cron Job Error]`,
      'non-error string'
    )
  })

  it.skip('should stop the cron job on server shutdown', async () => {
    await seedForecastScheduler.plugin.register(serverMock)
    const onPostStopHandler = serverMock.ext.mock.calls[0][1]

    onPostStopHandler()

    expect(stopMock).toHaveBeenCalled()
    expect(mockLogger.info).toHaveBeenCalledWith('Stopping forecast scheduler')
  })

  it.skip('should log and re-throw error if scheduler setup fails', async () => {
    schedule.mockImplementationOnce(() => {
      throw new Error('Scheduler setup failed')
    })

    await expect(
      seedForecastScheduler.plugin.register(serverMock)
    ).rejects.toThrow('Scheduler setup failed')
    expect(mockLogger.error).toHaveBeenCalledWith(
      `'Forecast sync job failed:'`,
      expect.any(Error)
    )
  })

  it.skip('should wrap and re-throw non-Error values during scheduler setup', async () => {
    schedule.mockImplementationOnce(() => {
      throw 'non-error setup failure'
    })

    await expect(
      seedForecastScheduler.plugin.register(serverMock)
    ).rejects.toThrow('non-error setup failure')
    expect(mockLogger.error).toHaveBeenCalledWith(
      `'Forecast sync job failed:'`,
      'non-error setup failure'
    )
  })
})
