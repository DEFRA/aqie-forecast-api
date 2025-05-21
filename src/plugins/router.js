import { health } from '../routes/health.js'
import { example } from '../routes/example.js'
//import { forecast } from '../routes/forecast/index.js'
import { forecast } from '../forecast/index.js'

const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      server.route([health].concat(forecast))
    }
  }
}

export { router }
