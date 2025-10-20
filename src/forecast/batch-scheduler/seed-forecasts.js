// import { schedule } from 'node-cron'
// import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { runForecastSyncJob } from './runForecastSyncJob.js'

let cronJob // store the job reference

// Schedule it to run daily at 5:00 AM
const seedForecastScheduler = {
  plugin: {
    name: 'Seed Forecast Scheduler',
    register: async (server) => {
      // Start the scheduler
      const logger = createLogger()
      try {
        logger.info('starting forecasts Scheduler')
        // cronJob = schedule(config.get('forecastSchedule'), async () => {})
        logger.info('Cron job triggered')
        logger.info('Inital forecasts Scheduler done! Running at 5am')
        try {
          await runForecastSyncJob(server)
        } catch (error) {
          logger.error(`[Cron Job Error]`, error)
          throw error instanceof Error ? error : new Error(String(error))
        }
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
