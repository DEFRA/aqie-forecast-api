import { forecastController } from './forecastController.js'
const forecast = [
  {
    method: 'GET',
    path: '/forecast',
    ...forecastController
  }
]

export { forecast }
