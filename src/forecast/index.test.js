import { forecast } from './index.js'
import { forecastController } from './forecastController.js'

describe('Forecast Route Configuration', () => {
  it('should export an array with one route', () => {
    expect(Array.isArray(forecast)).toBe(true)
    expect(forecast.length).toBe(1)
  })

  it('should define the correct method and path', () => {
    const route = forecast[0]
    expect(route.method).toBe('GET')
    expect(route.path).toBe('/forecast')
  })

  it('should include all properties from forecastController', () => {
    const route = forecast[0]
    for (const key of Object.keys(forecastController)) {
      expect(route).toHaveProperty(key, forecastController[key])
    }
  })
})
