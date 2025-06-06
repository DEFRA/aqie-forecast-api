/* eslint-disable */
jest.mock('../../common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn()
  })
}))
import { seedForecastScheduler } from './seed-forecasts.js'
import { runForecastSyncJob } from './runForecastSyncJob.js'
import { config } from '../../config.js'
import { schedule } from 'node-cron'

jest.mock('node-cron', () => ({
  schedule: jest.fn()
}))

jest.mock('../../config.js', () => ({
  config: {
    get: jest.fn()
  }
}))

jest.mock('./runForecastSyncJob.js', () => ({
  runForecastSyncJob: jest.fn()
}))

describe('seedForecastScheduler plugin', () => {
  let mockServer

  beforeEach(() => {
    jest.clearAllMocks()
    mockServer = { app: {}, db: {} }
  })

  it('should register the plugin and schedule the job', async () => {
    const cronExpression = '0 5 * * *' // 5:00 AM daily
    config.get.mockReturnValue(cronExpression)

    await seedForecastScheduler.plugin.register(mockServer)

    expect(config.get).toHaveBeenCalledWith('forecastSchedule')
    expect(schedule).toHaveBeenCalledWith(cronExpression, expect.any(Function))
  })

  it('should call runForecastSyncJob when cron job is triggered', async () => {
    const cronExpression = '0 5 * * *'
    config.get.mockReturnValue(cronExpression)

    let scheduledCallback
    schedule.mockImplementation((_, cb) => {
      scheduledCallback = cb
    })

    await seedForecastScheduler.plugin.register(mockServer)

    await scheduledCallback()

    expect(runForecastSyncJob).toHaveBeenCalledWith(mockServer)
  })

  it('should throw if runForecastSyncJob fails', async () => {
    const cronExpression = '0 5 * * *'
    config.get.mockReturnValue(cronExpression)

    let scheduledCallback
    schedule.mockImplementation((_, cb) => {
      scheduledCallback = cb
    })

    const error = new Error('Job failed')
    runForecastSyncJob.mockRejectedValue(error)

    await seedForecastScheduler.plugin.register(mockServer)

    await expect(scheduledCallback()).rejects.toThrow('Job failed')
    expect(runForecastSyncJob).toHaveBeenCalled()
  })
})
