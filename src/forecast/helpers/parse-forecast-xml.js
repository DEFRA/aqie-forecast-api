import xml2js from 'xml2js'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
dayjs.extend(utc)

export const parseForecastXml = async (xmlString) => {
  const parsed = await xml2js.parseStringPromise(xmlString, {
    explicitArray: false
  })

  const sites = parsed.DEFRAAirQuality.site
  if (!sites) return []
  const siteArray = Array.isArray(sites) ? sites : [sites]

  return siteArray
    .map((site) => {
      if (!site?.$) return null

      const baseDate = dayjs.utc(
        `${site.$.yr}-${site.$.mon}-${site.$.dayn}T${site.$.hr.slice(0, 2)}:00:00`
      )

      const forecastDays = Array.isArray(site.day) ? site.day : [site.day]

      const forecast = forecastDays.slice(0, 5).map((d, index) => ({
        day: baseDate.add(index, 'day').format('ddd'),
        value: parseInt(d.$.aq)
      }))

      return {
        name: site.$.lc,
        updated: baseDate.toDate(),
        location: {
          type: 'Point',
          coordinates: [parseFloat(site.$.lt), parseFloat(site.$.ln)]
        },
        forecast
      }
    })
    .filter(Boolean)
}
