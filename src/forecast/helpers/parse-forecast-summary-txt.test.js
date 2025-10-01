import { parseForecastSummaryTxt } from './parse-forecast-summary-txt.js'

describe('parseForecastSummaryTxt', () => {
  it('should extract issue date from valid line', () => {
    const txt = 'Issued on Monday, 2025-09-15 at 09:00 Local time'
    const result = parseForecastSummaryTxt(txt)
    expect(result.issue_date).toBe('2025-09-15 09:00:00')
  })

  it('should extract issue date with day name and comma', () => {
    const txt = 'Issued on Monday, 29 September 2025 at 04:10 Local time'
    const result = parseForecastSummaryTxt(txt)
    expect(result.issue_date).toBe('2025-09-29 04:10:00')
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

  it('should flush buffer when section ends with empty line', () => {
    const txt = `
      Today:
      Line one.
      Line two.

      Tomorrow:
      Line three.

      Outlook:
    `
    const result = parseForecastSummaryTxt(txt)
    expect(result.today).toBe('Line one. Line two.')
    expect(result.tomorrow).toBe('Line three.')
    expect(result.outlook).toBeUndefined()
  })

  it('should handle case-insensitive section headers', () => {
    const txt = `
      today:
      lower case today.

      TOMORROW:
      upper case tomorrow.

      OutLook:
      mixed case outlook.
    `
    const result = parseForecastSummaryTxt(txt)
    expect(result.today).toBe('lower case today.')
    expect(result.tomorrow).toBe('upper case tomorrow.')
    expect(result.outlook).toBe('mixed case outlook.')
  })

  it('should handle section header with no content', () => {
    const txt = `
      Today:
      
      Tomorrow:
    `
    const result = parseForecastSummaryTxt(txt)
    expect(result.today).toBeUndefined()
    expect(result.tomorrow).toBeUndefined()
    expect(result.outlook).toBeUndefined()
  })
})
