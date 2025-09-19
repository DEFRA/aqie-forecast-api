import dayjs from 'dayjs'

export const getExpectedFileName = () => {
  const today = dayjs().format('YYYYMMDD')
  return `MetOfficeDefraAQSites_${today}.xml`
}

export const getExpectedSummaryFileName = () => {
  const today = dayjs().format('YYYY-MM-DD')
  return `EMARC_AirQualityForecast_${today}-`
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))