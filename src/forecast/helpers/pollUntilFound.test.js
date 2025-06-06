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
})
