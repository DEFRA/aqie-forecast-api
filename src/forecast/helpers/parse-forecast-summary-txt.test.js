import { parseForecastSummaryTxt } from './parse-forecast-summary-txt.js'

describe('parseForecastSummaryTxt', () => {
  it('should extract issue date from valid line', () => {
    const txt = 'Issued on Monday, 2025-09-15 at 09:00 Local time'
    const result = parseForecastSummaryTxt(txt)
    expect(result.issue_date).toBe('2025-09-15 09:00:00')
  })

  it('should parse today, tomorrow, and outlook sections', () => {
    const txt = `
      Today:
      Some text for today.

      Tomorrow:
      Some text for tomorrow.

      Outlook:
      Some text for outlook.
    `
    const result = parseForecastSummaryTxt(txt)
    expect(result.today).toBe('Some text for today.')
    expect(result.tomorrow).toBe('Some text for tomorrow.')
    expect(result.outlook).toBe('Some text for outlook.')
  })

  it('should handle missing sections gracefully', () => {
    const txt = `
      Today:
      Only today section.
    `
    const result = parseForecastSummaryTxt(txt)
    expect(result.today).toBe('Only today section.')
    expect(result.tomorrow).toBeUndefined()
    expect(result.outlook).toBeUndefined()
  })

  it('should handle empty input', () => {
    const result = parseForecastSummaryTxt('')
    expect(result).toEqual({})
  })

  it('should ignore malformed issue date', () => {
    const txt = 'Issued on nonsense'
    const result = parseForecastSummaryTxt(txt)
    expect(result.issue_date).toBeUndefined()
  })

  it('should handle multiple lines in a section', () => {
    const txt = `
      Today:
      Line one.
      Line two.

      Tomorrow:
      Line three.
      Line four.
    `
    const result = parseForecastSummaryTxt(txt)
    expect(result.today).toBe('Line one. Line two.')
    expect(result.tomorrow).toBe('Line three. Line four.')
  })
})
