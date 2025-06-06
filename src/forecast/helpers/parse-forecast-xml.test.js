import { parseForecastXml } from './parse-forecast-xml.js'
import dayjs from 'dayjs'

describe('parseForecastXml', () => {
  const xml = `
    <DEFRAAirQuality>
      <site lc="TestLocation" yr="2025" mon="06" dayn="04" hr="12" lt="51.5" ln="-0.1">
        <day aq="2"/>
      </site>
    </DEFRAAirQuality>
  `

  test('should parse XML and return forecast object', async () => {
    const result = await parseForecastXml(xml)
    expect(result).toEqual([
      {
        name: 'TestLocation',
        updated: dayjs.utc('2025-06-04T12:00:00').toDate(),
        location: {
          type: 'Point',
          coordinates: [51.5, -0.1]
        },
        forecast: [
          { day: dayjs.utc('2025-06-04T12:00:00').format('ddd'), value: 2 }
        ]
      }
    ])
  })

  test('should parse valid XML and return forecast object', async () => {
    const result = await parseForecastXml(xml)
    expect(result[0].name).toBe('TestLocation')
    expect(result[0].forecast.length).toBeGreaterThan(0)
  })

  test('should handle empty XML gracefully', async () => {
    const emptyXml = '<DEFRAAirQuality></DEFRAAirQuality>'
    const result = await parseForecastXml(emptyXml)
    expect(result).toEqual([])
  })

  test('should throw error for malformed XML', async () => {
    await expect(parseForecastXml('<invalid>')).rejects.toThrow()
  })

  test('should parse multiple site entries correctly', async () => {
    const multiSiteXml = `
      <DEFRAAirQuality>
        <site lc="Location1" yr="2025" mon="06" dayn="04" hr="12" lt="51.5" ln="-0.1">
          <day aq="3"/>
        </site>
        <site lc="Location2" yr="2025" mon="06" dayn="04" hr="12" lt="52.5" ln="-1.1">
          <day aq="4"/>
        </site>
      </DEFRAAirQuality>
    `
    const result = await parseForecastXml(multiSiteXml)
    expect(result.length).toBe(2)
    expect(result[0].name).toBe('Location1')
    expect(result[1].name).toBe('Location2')
  })

  test('should skip site entries with missing attributes', async () => {
    const missingAttrXml = `
      <DEFRAAirQuality>
        <site>
          <day aq="2"/>
        </site>
      </DEFRAAirQuality>
    `
    const result = await parseForecastXml(missingAttrXml)
    expect(result).toEqual([])
  })

  test('should parse multiple forecast days correctly', async () => {
    const multiDayXml = `
      <DEFRAAirQuality>
        <site lc="TestLocation" yr="2025" mon="06" dayn="04" hr="12" lt="51.5" ln="-0.1">
          <day aq="2"/>
          <day aq="3"/>
          <day aq="4"/>
        </site>
      </DEFRAAirQuality>
    `
    const result = await parseForecastXml(multiDayXml)
    expect(result[0].forecast.length).toBe(3)
    expect(result[0].forecast[1].value).toBe(3)
  })

  test('should only include up to 5 forecast days', async () => {
    const longForecastXml = `
      <DEFRAAirQuality>
        <site lc="TestLocation" yr="2025" mon="06" dayn="04" hr="12" lt="51.5" ln="-0.1">
          <day aq="1"/><day aq="2"/><day aq="3"/><day aq="4"/><day aq="5"/><day aq="6"/>
        </site>
      </DEFRAAirQuality>
    `
    const result = await parseForecastXml(longForecastXml)
    expect(result[0].forecast.length).toBe(5)
  })
})
