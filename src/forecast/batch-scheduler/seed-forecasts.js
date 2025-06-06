/* eslint-disable */
import { schedule } from 'node-cron'
import { config } from '../../config.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { runForecastSyncJob } from './runForecastSyncJob.js'

const logger = createLogger()
let cronJob // store the job reference

// Schedule it to run daily at 5:00 AM
const seedForecastScheduler = {
  plugin: {
    name: 'Seed Forecast Scheduler',
    register: async (server) => {
      // Start the scheduler
      try {
        logger.info('starting forecasts Scheduler')
        cronJob = schedule(
          config.get('forecastSchedule'),
          async () => {
            logger.info('Cron job triggered')
            await runForecastSyncJob(server)
          }
          // {
          //   timezone: 'Europe/London' // or 'UTC' if you prefer UTC
          // }
        )
        logger.info('Inital forecasts Scheduler done! Running at 5am')

        // Stop the cron job when the server stops
        server.ext('onPostStop', () => {
          if (cronJob) {
            logger.info('Stopping forecast scheduler')
            cronJob.stop()
          }
        })
      } catch (error) {
        logger.error(`'Forecast sync job failed:', ${error}`)
      }
    }
  }
}
export { seedForecastScheduler }
