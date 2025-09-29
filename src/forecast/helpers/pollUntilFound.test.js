import { pollUntilFound } from './pollUntilFound.js'

describe('pollUntilFound', () => {
  let mockLogger,
    mockSftp,
    mockConnectSftp,
    mockForecastsCol,
    mockSummaryCol,
    mockParseForecastXml,
    mockParseForecastSummaryTxt,
    mockSleep

  beforeEach(() => {
    mockLogger = { info: jest.fn(), error: jest.fn() }
    mockSftp = { list: jest.fn(), get: jest.fn(), end: jest.fn() }
    mockConnectSftp = jest.fn().mockResolvedValue({ sftp: mockSftp })
    mockForecastsCol = { bulkWrite: jest.fn() }
    mockSummaryCol = { replaceOne: jest.fn() }
    mockParseForecastXml = jest.fn().mockResolvedValue([
      {
        name: 'Test',
        updated: new Date(),
        location: { type: 'Point', coordinates: [0, 0] },
        forecast: []
      }
    ])
    mockParseForecastSummaryTxt = jest.fn()
    mockSleep = jest.fn()
    jest.clearAllMocks()
  })

  test('should find file and insert forecasts', async () => {
    mockSftp.list.mockResolvedValue([
      { name: 'MetOfficeDefraAQSites_20250925.xml' }
    ])
    await pollUntilFound({
      filename: 'MetOfficeDefraAQSites_20250925.xml',
      logger: mockLogger,
      forecastsCol: mockForecastsCol,
      parseForecastXml: mockParseForecastXml,
      connectSftp: mockConnectSftp,
      sleep: mockSleep
    })
    expect(mockForecastsCol.bulkWrite).toHaveBeenCalled()
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        'Forecast file MetOfficeDefraAQSites_20250925.xml found'
      )
    )
  })

  test('should find summary file and insert summary', async () => {
    mockSftp.list.mockResolvedValue([
      { name: 'EMARC_AirQualityForecast_2025-09-25-0440.TXT' }
    ])
    mockSftp.get.mockResolvedValue('summary-content')
    mockParseForecastSummaryTxt.mockReturnValue({ summary: 'ok' })
    await pollUntilFound({
      summaryFilename: 'EMARC_AirQualityForecast_2025-09-25-0440',
      logger: mockLogger,
      summaryCol: mockSummaryCol,
      parseForecastSummaryTxt: mockParseForecastSummaryTxt,
      connectSftp: mockConnectSftp,
      sleep: mockSleep
    })
    expect(mockSummaryCol.replaceOne).toHaveBeenCalled()
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        'Summary file EMARC_AirQualityForecast_2025-09-25-0440.TXT found'
      )
    )
  })

  test('should exit when both forecast and summary files are found in one poll', async () => {
    mockSftp.list.mockResolvedValue([
      { name: 'MetOfficeDefraAQSites_20250925.xml' },
      { name: 'EMARC_AirQualityForecast_2025-09-25-0440.TXT' }
    ])
    mockSftp.get.mockImplementation((filePath) => {
      if (filePath.endsWith('.xml')) return Promise.resolve('<xml></xml>')
      if (filePath.endsWith('.TXT')) return Promise.resolve('summary-content')
    })
    mockParseForecastSummaryTxt.mockReturnValue({ summary: 'ok' })
    await pollUntilFound({
      filename: 'MetOfficeDefraAQSites_20250925.xml',
      summaryFilename: 'EMARC_AirQualityForecast_2025-09-25-0440',
      logger: mockLogger,
      forecastsCol: mockForecastsCol,
      parseForecastXml: mockParseForecastXml,
      summaryCol: mockSummaryCol,
      parseForecastSummaryTxt: mockParseForecastSummaryTxt,
      connectSftp: mockConnectSftp,
      sleep: mockSleep
    })
    expect(mockForecastsCol.bulkWrite).toHaveBeenCalled()
    expect(mockSummaryCol.replaceOne).toHaveBeenCalled()
  })

  test('should retry if summary file not found', async () => {
    mockSftp.list
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { name: 'EMARC_AirQualityForecast_2025-09-25-0440.TXT' }
      ])
    mockSftp.get.mockResolvedValue('summary-content')
    mockParseForecastSummaryTxt.mockReturnValue({ summary: 'ok' })
    await pollUntilFound({
      summaryFilename: 'EMARC_AirQualityForecast_2025-09-25-0440',
      logger: mockLogger,
      summaryCol: mockSummaryCol,
      parseForecastSummaryTxt: mockParseForecastSummaryTxt,
      connectSftp: mockConnectSftp,
      sleep: mockSleep,
      maxAttempts: 2
    })
    expect(mockSleep).toHaveBeenCalled()
    expect(mockSummaryCol.replaceOne).toHaveBeenCalled()
  })

  test('should handle summary TXT parsing error and log it', async () => {
    mockSftp.list.mockResolvedValue([
      { name: 'EMARC_AirQualityForecast_2025-09-25-0440.TXT' }
    ])
    mockSftp.get.mockResolvedValue('bad-summary-content')
    mockParseForecastSummaryTxt.mockRejectedValueOnce(new Error('Invalid TXT'))
    try {
      await pollUntilFound({
        summaryFilename: 'EMARC_AirQualityForecast_2025-09-25-0440',
        logger: mockLogger,
        summaryCol: mockSummaryCol,
        parseForecastSummaryTxt: mockParseForecastSummaryTxt,
        connectSftp: mockConnectSftp,
        sleep: mockSleep,
        maxAttempts: 2
      })
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect(err.message).toBe('Invalid TXT')
    }
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        '[TXT Parsing Error] Summary file found but could not be parsed: Invalid TXT'
      ),
      expect.any(Error)
    )
  })

  test('should handle error thrown by summaryCol.replaceOne', async () => {
    mockSftp.list.mockResolvedValue([
      { name: 'EMARC_AirQualityForecast_2025-09-25-0440.TXT' }
    ])
    mockSftp.get.mockResolvedValue('summary-content')
    mockParseForecastSummaryTxt.mockReturnValue({ summary: 'ok' })
    mockSummaryCol.replaceOne.mockImplementation(() => {
      throw new Error('replace error')
    })
    try {
      await pollUntilFound({
        summaryFilename: 'EMARC_AirQualityForecast_2025-09-25-0440',
        logger: mockLogger,
        summaryCol: mockSummaryCol,
        parseForecastSummaryTxt: mockParseForecastSummaryTxt,
        connectSftp: mockConnectSftp,
        sleep: mockSleep,
        maxAttempts: 2
      })
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect(err.message).toBe('replace error')
    }
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('replace error'),
      expect.any(Error)
    )
  })

  test('should log alert if summary file not uploaded', async () => {
    mockSftp.list.mockResolvedValue([])
    let callCount = 0
    mockSleep.mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        jest.spyOn(Date, 'now').mockImplementation(() => {
          const now = new Date()
          now.setHours(10, 1, 0, 0)
          return now.getTime()
        })
      } else if (callCount === 2) {
        jest.spyOn(Date, 'now').mockImplementation(() => {
          const now = new Date()
          now.setHours(15, 1, 0, 0)
          return now.getTime()
        })
      } else {
        throw new Error('stop')
      }
    })
    try {
      await pollUntilFound({
        summaryFilename: 'EMARC_AirQualityForecast_2025-09-25-0440',
        logger: mockLogger,
        summaryCol: mockSummaryCol,
        parseForecastSummaryTxt: mockParseForecastSummaryTxt,
        connectSftp: mockConnectSftp,
        sleep: mockSleep,
        maxAttempts: 3
      })
    } catch {}
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        '[Alert] Summary file not uploaded to MetOffice SFTP'
      )
    )
    jest.spyOn(Date, 'now').mockRestore()
  })

  test('should insert forecasts when file is found', async () => {
    mockSftp.list.mockResolvedValue([
      { name: 'MetOfficeDefraAQSites_20250925.xml' }
    ])
    mockSftp.get.mockResolvedValue('<xml></xml>')
    mockParseForecastXml.mockResolvedValue([
      {
        name: 'Test',
        forecast: [],
        updated: new Date(),
        location: { type: 'Point', coordinates: [0, 0] }
      }
    ])
    await pollUntilFound({
      filename: 'MetOfficeDefraAQSites_20250925.xml',
      logger: mockLogger,
      forecastsCol: mockForecastsCol,
      parseForecastXml: mockParseForecastXml,
      connectSftp: mockConnectSftp,
      sleep: mockSleep
    })
    expect(mockForecastsCol.bulkWrite).toHaveBeenCalled()
  })

  test('should retry if file not found', async () => {
    mockSftp.list.mockResolvedValueOnce([])
    mockSftp.list.mockResolvedValueOnce([
      { name: 'MetOfficeDefraAQSites_20250925.xml' }
    ])
    mockSftp.get.mockResolvedValue('<xml></xml>')
    mockParseForecastXml.mockResolvedValue([
      {
        name: 'Test',
        forecast: [],
        updated: new Date(),
        location: { type: 'Point', coordinates: [0, 0] }
      }
    ])
    await pollUntilFound({
      filename: 'MetOfficeDefraAQSites_20250925.xml',
      logger: mockLogger,
      forecastsCol: mockForecastsCol,
      parseForecastXml: mockParseForecastXml,
      connectSftp: mockConnectSftp,
      sleep: mockSleep,
      maxAttempts: 2
    })
    expect(mockSleep).toHaveBeenCalled()
  })

  test('should handle SFTP connection error', async () => {
    mockConnectSftp.mockRejectedValueOnce(new Error('Connection error'))
    await pollUntilFound({
      filename: 'MetOfficeDefraAQSites_20250925.xml',
      logger: mockLogger,
      forecastsCol: mockForecastsCol,
      parseForecastXml: mockParseForecastXml,
      connectSftp: mockConnectSftp,
      sleep: mockSleep,
      maxAttempts: 2
    })
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Connection error'),
      expect.any(Error)
    )
  })

  test('should handle XML parsing error and log it', async () => {
    mockSftp.list.mockResolvedValue([
      { name: 'MetOfficeDefraAQSites_20250925.xml' }
    ])
    mockSftp.get.mockResolvedValue('<invalid-xml>')
    mockParseForecastXml.mockRejectedValueOnce(new Error('Invalid XML'))
    try {
      await pollUntilFound({
        filename: 'MetOfficeDefraAQSites_20250925.xml',
        logger: mockLogger,
        forecastsCol: mockForecastsCol,
        parseForecastXml: mockParseForecastXml,
        connectSftp: mockConnectSftp,
        sleep: mockSleep,
        maxAttempts: 2
      })
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect(err.message).toBe('Invalid XML')
    }
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        '[XML Parsing Error] Forecast file found but could not be parsed: Invalid XML'
      ),
      expect.any(Error)
    )
  })

  test('should wrap non-Error thrown by parseForecastXml', async () => {
    mockSftp.list.mockResolvedValue([
      { name: 'MetOfficeDefraAQSites_20250925.xml' }
    ])
    mockSftp.get.mockResolvedValue('<invalid-xml>')
    mockParseForecastXml.mockRejectedValueOnce('non-error string')
    try {
      await pollUntilFound({
        filename: 'MetOfficeDefraAQSites_20250925.xml',
        logger: mockLogger,
        forecastsCol: mockForecastsCol,
        parseForecastXml: mockParseForecastXml,
        connectSftp: mockConnectSftp,
        sleep: mockSleep,
        maxAttempts: 2
      })
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect(err.message).toBe('non-error string')
    }
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        '[XML Parsing Error] Forecast file found but could not be parsed:'
      ),
      'non-error string'
    )
  })

  test('should handle error thrown after file not found and retry', async () => {
    mockSftp.list.mockResolvedValue([]) // file not found
    mockSftp.end.mockImplementation(() => {
      throw new Error('end error')
    })
    mockSleep.mockImplementationOnce(() => {
      throw new Error('stop')
    }) // break loop
    try {
      await pollUntilFound({
        filename: 'MetOfficeDefraAQSites_20250925.xml',
        logger: mockLogger,
        forecastsCol: mockForecastsCol,
        parseForecastXml: mockParseForecastXml,
        connectSftp: mockConnectSftp,
        sleep: mockSleep,
        maxAttempts: 2
      })
    } catch {}
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('end error'),
      expect.any(Error)
    )
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('[Retry] Waiting')
    )
  })

  test('should log both 10:00 and 15:00 alerts if file not found', async () => {
    mockSftp.list.mockResolvedValue([])
    let callCount = 0
    mockSleep.mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        jest.spyOn(Date, 'now').mockImplementation(() => {
          const now = new Date()
          now.setHours(10, 1, 0, 0)
          return now.getTime()
        })
      } else if (callCount === 2) {
        jest.spyOn(Date, 'now').mockImplementation(() => {
          const now = new Date()
          now.setHours(15, 1, 0, 0)
          return now.getTime()
        })
      } else {
        throw new Error('stop')
      }
    })
    try {
      await pollUntilFound({
        filename: 'MetOfficeDefraAQSites_20250925.xml',
        logger: mockLogger,
        forecastsCol: mockForecastsCol,
        parseForecastXml: mockParseForecastXml,
        connectSftp: mockConnectSftp,
        sleep: mockSleep,
        maxAttempts: 3
      })
    } catch {}
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        '[Alert] Forecast file not uploaded to MetOffice SFTP'
      )
    )
    jest.spyOn(Date, 'now').mockRestore()
  })
})
