import { createLogger } from '../../common/helpers/logging/logger.js'
import { schedule } from 'node-cron'
import { config } from '../../config.js'
import { fetchForecast, saveForecasts } from './fetch-forecasts.js'
// import { acquireLock, requireLock } from '../../common/helpers/mongo-lock.js'

const logger = createLogger()

// Initial feed into the DB after successfully connect to the sftp defra server and fetch the forecast file.
const forecastScheduler = {
  plugin: {
    name: 'Forecast Scheduler',
    register: async (server) => {
      // Start the scheduler
      // await fetchAndSaveForecasts(server)
      logger.info('starting forecasts Scheduler')
      logger.info(
        `Forecasts Scheduler Server time at startup: ${new Date().toString()}`
      )
      logger.info(
        `'Using forecast schedule:', ${config.get('seedForecastSchedule')}`
      )
      schedule(
        config.get('seedForecastSchedule'),
        async () => {
          logger.info('Cron job triggered')
          await fetchAndSaveForecasts(server)
        },
        {
          timezone: 'Europe/London' // or 'UTC' if you prefer UTC
        }
      )
      logger.info(
        'Inital forecasts Scheduler done! Running once at 3:30am to 12.30pm'
      )
    }
  }
}

async function fetchAndSaveForecasts(server) {
  // if (await acquireLock(server.db, 'forecasts', logger)) {
  try {
    const forecasts = await fetchForecast()
    await saveForecasts(server, forecasts)
    logger.info('saveForecasts done!')
  } catch (err) {
    logger.error('Error fetching and saving forecasts', err)
  }
  //     finally {
  //       await requireLock(server.db, 'forecasts')
  //     }
  //   }
  // logger.info('forecast save bypassed!')
}

export { forecastScheduler }
