import { schedule } from 'node-cron'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { runForecastSyncJob } from './runForecastSyncJob.js'

let cronJob // store the job reference

// Runs the forecast & summary sync on the schedule configured by FORECAST_SCHEDULE
const seedForecastScheduler = {
  plugin: {
    name: 'Seed Forecast Scheduler',
    register: async (server) => {
      // Start the scheduler
      const logger = createLogger()
      try {
        logger.info('starting forecasts Scheduler')
        cronJob = schedule(config.get('forecastSchedule'), async () => {
          logger.info(
            `Forecast & summary sync triggered by schedule '${config.get('forecastSchedule')}'`
          )
          try {
            await runForecastSyncJob(server)
          } catch (error) {
            logger.error(`[Cron Job Error]`, error)
            throw error instanceof Error ? error : new Error(String(error))
          }
        })
        // Stop the cron job when the server stops
        server.ext('onPostStop', () => {
          if (cronJob) {
            logger.info('Stopping forecast scheduler')
            cronJob.stop()
          }
        })
      } catch (error) {
        logger.error(`'Forecast sync job failed:'`, error)
        throw error instanceof Error ? error : new Error(String(error))
      }
    }
  }
}
export { seedForecastScheduler }
