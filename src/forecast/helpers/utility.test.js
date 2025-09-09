import { sleep, getExpectedFileName } from './utility.js'
import dayjs from 'dayjs'

describe('sleep', () => {
  jest.useFakeTimers()

  test('should resolve after specified time', async () => {
    const ms = 1000
    const promise = sleep(ms)
    jest.advanceTimersByTime(ms)
    await expect(promise).resolves.toBeUndefined()
  })
})

describe('getExpectedFileName', () => {
  test('should return correct filename for today', () => {
    const today = dayjs().format('YYYYMMDD')
    const expected = `MetOfficeDefraAQSites_${today}.xml`
    expect(getExpectedFileName()).toBe(expected)
  })
})
