// import dayjs from 'dayjs'

export const getExpectedFileName = () => {
  // const today = dayjs().format('YYYYMMDD')
  // return `MetOfficeDefraAQSites_${today}.xml` // //MetOfficeDefraAQSites_20250425.xml
  return `MetOfficeDefraAQSites_20250902.xml`
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
