import { health } from '../routes/health.js'
import { forecast } from '../forecast/index.js'
import { metOfficeForecast } from '../routes/read-forecast.js'

const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      server.route([health].concat(metOfficeForecast).concat(forecast))
    }
  }
}

export { router }
