import dayjs from 'dayjs'
import {
  getExpectedFileName,
  getExpectedSummaryFileName,
  sleep
} from './utility.js'

describe('utility.js', () => {
  it('getExpectedFileName returns correct filename', () => {
    const today = dayjs().format('YYYYMMDD')
    expect(getExpectedFileName()).toBe(`MetOfficeDefraAQSites_${today}.xml`)
  })

  it('getExpectedSummaryFileName returns correct filename', () => {
    const today = dayjs().format('YYYY-MM-DD')
    expect(getExpectedSummaryFileName()).toBe(
      `EMARC_AirQualityForecast_${today}-`
    )
  })

  it('sleep resolves after the given ms', async () => {
    jest.useFakeTimers()
    try {
      const resolved = jest.fn()
      const promise = sleep(9).then(resolved)

      // Not resolved before the timer elapses
      await Promise.resolve()
      expect(resolved).not.toHaveBeenCalled()

      jest.advanceTimersByTime(9)
      await promise
      expect(resolved).toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })
})
