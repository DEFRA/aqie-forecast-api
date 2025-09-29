import { getForecastsFromDB } from './helpers/get-db-forecasts.js'
import { getForecastSummaryFromDB } from './helpers/get-db-summary.js'
import { config } from '../config.js'
import { createLogger } from '../common/helpers/logging/logger.js'

const logger = createLogger()
const forecastController = {
  handler: async (request, h) => {
    const forecasts = await getForecastsFromDB(request.db)
    const forecastSummary = await getForecastSummaryFromDB(request.db)
    logger.info(`forecasts length in database:: ${forecasts.length}`)
    const allowOriginUrl = config.get('allowOriginUrl')
    return h
      .response({
        message: 'success',
        forecasts,
        'forecast-summary': forecastSummary
      })
      .code(200)
      .header('Access-Control-Allow-Origin', allowOriginUrl)
  }
}

export { forecastController }
