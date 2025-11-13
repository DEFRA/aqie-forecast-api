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

  it('sleep resolves after given ms', async () => {
    const start = Date.now()
    await sleep(9)
    expect(Date.now() - start).toBeGreaterThanOrEqual(9)
  })
})
