import { forecastController } from './forecastController.js'
import { testController } from '../test/testController.js'
const forecast = [
  {
    method: 'GET',
    path: '/forecast',
    ...forecastController
  },
  {
    method: 'GET',
    path: '/test',
    ...testController
  }
]

export { forecast }
