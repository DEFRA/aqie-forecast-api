import { pollUntilFound } from './pollUntilFound.js'

describe('pollUntilFound', () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn()
  }

  const mockSftp = {
    list: jest
      .fn()
      .mockResolvedValue([{ name: 'MetOfficeDefraAQSites_20250604.xml' }]),
    get: jest.fn().mockResolvedValue('<xml></xml>'),
    end: jest.fn()
  }

  const mockConnectSftp = jest.fn().mockResolvedValue({ sftp: mockSftp })

  const mockForecastsCol = {
    bulkWrite: jest.fn()
  }

  const mockParseForecastXml = jest.fn().mockResolvedValue([
    {
      name: 'Test',
      updated: new Date(),
      location: { type: 'Point', coordinates: [0, 0] },
      forecast: []
    }
  ])

  const mockSleep = jest.fn()

  test('should find file and insert forecasts', async () => {
    await pollUntilFound({
      filename: 'MetOfficeDefraAQSites_20250604.xml',
      logger: mockLogger,
      forecastsCol: mockForecastsCol,
      parseForecastXml: mockParseForecastXml,
      connectSftp: mockConnectSftp,
      sleep: mockSleep
    })

    expect(mockForecastsCol.bulkWrite).toHaveBeenCalled()
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('File MetOfficeDefraAQSites_20250604.xml found')
    )
  })
})

describe('pollUntilFound', () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn()
  }

  const mockSftp = {
    list: jest.fn(),
    get: jest.fn(),
    end: jest.fn()
  }

  const mockConnectSftp = jest.fn(() => Promise.resolve({ sftp: mockSftp }))
  const mockForecastsCol = { bulkWrite: jest.fn() }
  const mockParseForecastXml = jest.fn()
  const mockSleep = jest.fn(() => Promise.resolve())

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('should insert forecasts when file is found', async () => {
    mockSftp.list.mockResolvedValue([
      { name: 'MetOfficeDefraAQSites_20250604.xml' }
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
      filename: 'MetOfficeDefraAQSites_20250604.xml',
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
      { name: 'MetOfficeDefraAQSites_20250604.xml' }
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
      filename: 'MetOfficeDefraAQSites_20250604.xml',
      logger: mockLogger,
      forecastsCol: mockForecastsCol,
      parseForecastXml: mockParseForecastXml,
      connectSftp: mockConnectSftp,
      sleep: mockSleep
    })

    expect(mockSleep).toHaveBeenCalled()
  })

  test('should handle SFTP connection error', async () => {
    mockConnectSftp.mockRejectedValueOnce(new Error('Connection error'))

    await pollUntilFound({
      filename: 'MetOfficeDefraAQSites_20250604.xml',
      logger: mockLogger,
      forecastsCol: mockForecastsCol,
      parseForecastXml: mockParseForecastXml,
      connectSftp: mockConnectSftp,
      sleep: mockSleep
    })

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Connection error'),
      expect.any(Error)
    )
  })

  test('should handle XML parsing error and log it', async () => {
    mockSftp.list.mockResolvedValue([
      { name: 'MetOfficeDefraAQSites_20250604.xml' }
    ])
    mockSftp.get.mockResolvedValue('<invalid-xml>')

    // Force parseForecastXml to throw
    mockParseForecastXml.mockRejectedValueOnce(new Error('Invalid XML'))

    // Prevent infinite loop
    try {
      await pollUntilFound({
        filename: 'MetOfficeDefraAQSites_20250604.xml',
        logger: mockLogger,
        forecastsCol: mockForecastsCol,
        parseForecastXml: mockParseForecastXml,
        connectSftp: mockConnectSftp,
        sleep: mockSleep,
        maxAttempts: 1 // limit loop for testing
      })
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect(err.message).toBe('Invalid XML')
    }

    expect(mockLogger.error).toHaveBeenCalledWith(
      '[XML Parsing Error] Invalid XML',
      expect.any(Error)
    )
  })

  test('should wrap non-Error thrown by parseForecastXml', async () => {
    mockSftp.list.mockResolvedValue([
      { name: 'MetOfficeDefraAQSites_20250604.xml' }
    ])
    mockSftp.get.mockResolvedValue('<invalid-xml>')

    // Simulate non-Error thrown
    mockParseForecastXml.mockRejectedValueOnce('non-error string')

    try {
      await pollUntilFound({
        filename: 'MetOfficeDefraAQSites_20250604.xml',
        logger: mockLogger,
        forecastsCol: mockForecastsCol,
        parseForecastXml: mockParseForecastXml,
        connectSftp: mockConnectSftp,
        sleep: mockSleep,
        maxAttempts: 1
      })
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect(err.message).toBe('non-error string')
    }

    expect(mockLogger.error).toHaveBeenCalledWith(
      '[XML Parsing Error] undefined',
      'non-error string'
    )
  })
})
