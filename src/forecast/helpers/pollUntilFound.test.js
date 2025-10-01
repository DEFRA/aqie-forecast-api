import { pollUntilFound } from './pollUntilFound.js'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(isSameOrAfter)

jest.setTimeout(5000)

// Mock constants
jest.mock('./constant.js', () => ({
  FIFTEEN: 15,
  TEN: 10,
  RETRY_MINUTES: 60000,
  THIRTY: 30,
  TWENTY_THREE: 23
}))

// Mock config
jest.mock('../../config.js', () => ({
  config: {
    get: jest.fn((key) => {
      if (key === 'forecastRetryInterval') return 100
      return undefined
    })
  }
}))

// Mock dayjs at module level
jest.mock('dayjs', () => {
  const mockDayjs = jest.fn()
  mockDayjs.extend = jest.fn()
  return mockDayjs
})

describe('pollUntilFound', () => {
  let mockLogger, mockSftp, mockConnectSftp, mockForecastsCol, mockSummaryCol
  let mockParseForecastXml, mockParseForecastSummaryTxt, mockSleep

  beforeEach(() => {
    jest.clearAllMocks()

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    }

    // Mock SFTP
    mockSftp = {
      list: jest.fn(),
      get: jest.fn(),
      end: jest.fn()
    }
    mockConnectSftp = jest.fn().mockResolvedValue({ sftp: mockSftp })

    // Mock database collections
    mockForecastsCol = {
      bulkWrite: jest.fn().mockResolvedValue({ result: { nInserted: 1 } })
    }
    mockSummaryCol = {
      replaceOne: jest.fn().mockResolvedValue({ result: { nModified: 1 } })
    }

    // Mock parsing functions
    mockParseForecastXml = jest.fn().mockResolvedValue([
      {
        name: 'MetOfficeDefraAQSites_20250925.xml',
        updated: new Date(),
        location: { type: 'Point', coordinates: [0, 0] },
        forecast: []
      }
    ])

    mockParseForecastSummaryTxt = jest.fn().mockReturnValue({
      date: '2025-09-25',
      summary: 'ok'
    })

    // Mock sleep function
    mockSleep = jest.fn().mockResolvedValue()
  })

  describe('cutoff time behavior', () => {
    test('terminates when past cutoff time after first attempt', async () => {
      const mockCutoffTime = {
        format: jest.fn().mockReturnValue('2025-09-25 23:30:00')
      }

      const mockAlertTime1 = { format: jest.fn().mockReturnValue('10:00') }
      const mockAlertTime2 = { format: jest.fn().mockReturnValue('15:00') }

      const mockTodayObj = {
        add: jest.fn().mockImplementation((amount, unit) => {
          if (amount === 23 && unit === 'hour') {
            return {
              add: jest.fn().mockReturnValue(mockCutoffTime)
            }
          }
          if (amount === 10 && unit === 'hour') {
            return mockAlertTime1
          }
          if (amount === 15 && unit === 'hour') {
            return mockAlertTime2
          }
          return this
        }),
        format: jest.fn().mockReturnValue('2025-09-25')
      }

      const mockNowObj = {
        isAfter: jest
          .fn()
          .mockReturnValueOnce(false) // First check: before cutoff (enters while loop)
          .mockReturnValue(true), // Second check: past cutoff (exits while loop)
        format: jest.fn().mockReturnValue('2025-09-25 23:35:00'),
        isSameOrAfter: jest.fn().mockReturnValue(true)
      }

      // Mock dayjs calls - setup then while loop iterations
      dayjs
        .mockReturnValueOnce({
          tz: jest.fn().mockReturnValue({
            startOf: jest.fn().mockReturnValue(mockTodayObj)
          })
        })
        .mockReturnValue({
          tz: jest.fn().mockReturnValue(mockNowObj)
        })

      // Mock SFTP list to return empty (no files found)
      mockSftp.list.mockResolvedValue([])

      await pollUntilFound({
        type: 'both',
        filename: 'missing.xml',
        summaryFilename: 'missing',
        logger: mockLogger,
        forecastsCol: mockForecastsCol,
        parseForecastXml: mockParseForecastXml,
        summaryCol: mockSummaryCol,
        parseForecastSummaryTxt: mockParseForecastSummaryTxt,
        connectSftp: mockConnectSftp,
        sleep: mockSleep
      })

      // Verify it connects once and then terminates
      expect(mockConnectSftp).toHaveBeenCalledTimes(1)
      expect(mockSftp.list).toHaveBeenCalledTimes(1)
      expect(mockSftp.end).toHaveBeenCalledTimes(1)

      // Verify it logs the polling ended message
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          '[Polling Ended] The following file(s) were not found by cutoff time'
        )
      )

      // Sleep is called once because files are not found, then cutoff is reached
      expect(mockSleep).toHaveBeenCalledTimes(1)
      expect(mockSleep).toHaveBeenCalledWith(100)
    })
  })

  describe('file processing', () => {
    test('processes forecast file successfully when found', async () => {
      const mockCutoffTime = {
        format: jest.fn().mockReturnValue('2025-09-25 23:30:00')
      }

      const mockAlertTime1 = { format: jest.fn().mockReturnValue('10:00') }
      const mockAlertTime2 = { format: jest.fn().mockReturnValue('15:00') }

      const mockTodayObj = {
        add: jest.fn().mockImplementation((amount, unit) => {
          if (amount === 23 && unit === 'hour') {
            return {
              add: jest.fn().mockReturnValue(mockCutoffTime)
            }
          }
          if (amount === 10 && unit === 'hour') {
            return mockAlertTime1
          }
          if (amount === 15 && unit === 'hour') {
            return mockAlertTime2
          }
          return this
        }),
        format: jest.fn().mockReturnValue('2025-09-25')
      }

      const mockNowObj = {
        isAfter: jest.fn().mockReturnValue(false), // Before cutoff time
        format: jest.fn().mockReturnValue('2025-09-25 15:00:00'),
        isSameOrAfter: jest.fn().mockReturnValue(false)
      }

      // Mock dayjs to return different objects for different calls
      dayjs
        .mockReturnValueOnce({
          tz: jest.fn().mockReturnValue({
            startOf: jest.fn().mockReturnValue(mockTodayObj)
          })
        })
        .mockReturnValue({
          tz: jest.fn().mockReturnValue(mockNowObj)
        })

      // Mock SFTP to return the forecast file
      mockSftp.list.mockResolvedValue([
        { name: 'MetOfficeDefraAQSites_20250925.xml' }
      ])
      mockSftp.get.mockResolvedValue('<xml>forecast content</xml>')

      await pollUntilFound({
        type: 'forecast', // Only looking for forecast file
        filename: 'MetOfficeDefraAQSites_20250925.xml',
        logger: mockLogger,
        forecastsCol: mockForecastsCol,
        parseForecastXml: mockParseForecastXml,
        connectSftp: mockConnectSftp,
        sleep: mockSleep
      })

      // Verify SFTP operations
      expect(mockConnectSftp).toHaveBeenCalledTimes(1)
      expect(mockSftp.list).toHaveBeenCalledWith(
        '/Incoming Shares/AQIE/MetOffice/'
      )
      expect(mockSftp.get).toHaveBeenCalledWith(
        '/Incoming Shares/AQIE/MetOffice/MetOfficeDefraAQSites_20250925.xml'
      )
      expect(mockSftp.end).toHaveBeenCalledTimes(1)

      // Verify parsing and database operations
      expect(mockParseForecastXml).toHaveBeenCalledWith(
        '<xml>forecast content</xml>'
      )
      expect(mockForecastsCol.bulkWrite).toHaveBeenCalledWith([
        {
          replaceOne: {
            filter: { name: 'MetOfficeDefraAQSites_20250925.xml' },
            replacement: {
              name: 'MetOfficeDefraAQSites_20250925.xml',
              updated: expect.any(Date),
              location: { type: 'Point', coordinates: [0, 0] },
              forecast: []
            },
            upsert: true
          }
        }
      ])

      // Verify sleep was NOT called (file found immediately)
      expect(mockSleep).not.toHaveBeenCalled()
    })
  })

  describe('polling logic', () => {
    test('polls multiple times when files not initially found', async () => {
      const mockCutoffTime = {
        format: jest.fn().mockReturnValue('2025-09-25 23:30:00')
      }

      const mockAlertTime1 = { format: jest.fn().mockReturnValue('10:00') }
      const mockAlertTime2 = { format: jest.fn().mockReturnValue('15:00') }

      const mockTodayObj = {
        add: jest.fn().mockImplementation((amount, unit) => {
          if (amount === 23 && unit === 'hour') {
            return {
              add: jest.fn().mockReturnValue(mockCutoffTime)
            }
          }
          if (amount === 10 && unit === 'hour') {
            return mockAlertTime1
          }
          if (amount === 15 && unit === 'hour') {
            return mockAlertTime2
          }
          return this
        }),
        format: jest.fn().mockReturnValue('2025-09-25')
      }

      const mockNowObj = {
        isAfter: jest
          .fn()
          .mockReturnValueOnce(false) // First iteration: before cutoff
          .mockReturnValueOnce(false) // Second iteration: before cutoff
          .mockReturnValueOnce(false) // Third iteration: before cutoff
          .mockReturnValue(true), // Fourth iteration: past cutoff (terminate)
        format: jest.fn().mockReturnValue('2025-09-25 15:00:00'),
        isSameOrAfter: jest.fn().mockReturnValue(false)
      }

      // Mock dayjs calls - first for setup, then for each while loop iteration
      dayjs
        .mockReturnValueOnce({
          tz: jest.fn().mockReturnValue({
            startOf: jest.fn().mockReturnValue(mockTodayObj)
          })
        })
        .mockReturnValue({
          tz: jest.fn().mockReturnValue(mockNowObj)
        })

      // Mock SFTP to return empty (no files found)
      mockSftp.list.mockResolvedValue([])

      await pollUntilFound({
        type: 'forecast',
        filename: 'missing.xml',
        logger: mockLogger,
        forecastsCol: mockForecastsCol,
        parseForecastXml: mockParseForecastXml,
        connectSftp: mockConnectSftp,
        sleep: mockSleep
      })

      // Should try 3 times before timing out
      expect(mockConnectSftp).toHaveBeenCalledTimes(3)
      expect(mockSftp.list).toHaveBeenCalledTimes(3)
      expect(mockSftp.end).toHaveBeenCalledTimes(3)

      // Should sleep 3 times (after each unsuccessful attempt)
      expect(mockSleep).toHaveBeenCalledTimes(3)
      expect(mockSleep).toHaveBeenCalledWith(100)
    })
  })

  describe('error handling', () => {
    test('handles SFTP connection errors gracefully', async () => {
      const mockCutoffTime = {
        format: jest.fn().mockReturnValue('2025-09-25 23:30:00')
      }

      const mockTodayObj = {
        add: jest.fn().mockImplementation((amount, unit) => {
          if (amount === 23 && unit === 'hour') {
            return {
              add: jest.fn().mockReturnValue(mockCutoffTime)
            }
          }
          return this
        }),
        format: jest.fn().mockReturnValue('2025-09-25')
      }

      const mockNowObj = {
        isAfter: jest
          .fn()
          .mockReturnValueOnce(false) // First check: before cutoff
          .mockReturnValue(true), // Second check: past cutoff (terminate)
        format: jest.fn().mockReturnValue('2025-09-25 15:00:00')
      }

      dayjs
        .mockReturnValueOnce({
          tz: jest.fn().mockReturnValue({
            startOf: jest.fn().mockReturnValue(mockTodayObj)
          })
        })
        .mockReturnValue({
          tz: jest.fn().mockReturnValue(mockNowObj)
        })

      // Mock SFTP connection to fail first time only
      const sftpError = new Error('SFTP connection failed')
      mockConnectSftp.mockRejectedValueOnce(sftpError)

      await pollUntilFound({
        type: 'forecast',
        filename: 'test.xml',
        logger: mockLogger,
        forecastsCol: mockForecastsCol,
        parseForecastXml: mockParseForecastXml,
        connectSftp: mockConnectSftp,
        sleep: mockSleep
      })

      // Verify error was logged and sleep was called
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[Error] While checking SFTP: SFTP connection failed',
        sftpError
      )
      // Only called once because the error occurs and then cutoff time is reached
      expect(mockConnectSftp).toHaveBeenCalledTimes(1)
      expect(mockSleep).toHaveBeenCalledWith(100)
    })

    test('should handle XML parsing errors in processForecast', async () => {
      const mockCutoffTime = {
        format: jest.fn().mockReturnValue('2025-09-25 23:30:00')
      }

      const mockAlertTime1 = { format: jest.fn().mockReturnValue('10:00') }
      const mockAlertTime2 = { format: jest.fn().mockReturnValue('15:00') }

      const mockTodayObj = {
        add: jest.fn().mockImplementation((amount, unit) => {
          if (amount === 23 && unit === 'hour') {
            return {
              add: jest.fn().mockReturnValue(mockCutoffTime)
            }
          }
          if (amount === 10 && unit === 'hour') {
            return mockAlertTime1
          }
          if (amount === 15 && unit === 'hour') {
            return mockAlertTime2
          }
          return this
        }),
        format: jest.fn().mockReturnValue('2025-09-25')
      }

      const mockNowObj = {
        isAfter: jest
          .fn()
          .mockReturnValueOnce(false) // First check: before cutoff (enter loop)
          .mockReturnValue(true), // Second check: past cutoff (exit after processing)
        format: jest.fn().mockReturnValue('2025-09-25 15:00:00'),
        isSameOrAfter: jest.fn().mockReturnValue(false)
      }

      dayjs
        .mockReturnValueOnce({
          tz: jest.fn().mockReturnValue({
            startOf: jest.fn().mockReturnValue(mockTodayObj)
          })
        })
        .mockReturnValue({
          tz: jest.fn().mockReturnValue(mockNowObj)
        })

      // Mock SFTP to return a forecast file
      mockSftp.list.mockResolvedValue([
        { name: 'MetOfficeDefraAQSites_20250925.xml' }
      ])
      mockSftp.get.mockResolvedValue('<xml>malformed content</xml>')

      // Mock parseForecastXml to throw an error
      const xmlError = new Error('XML parsing failed')
      mockParseForecastXml.mockRejectedValue(xmlError)

      // Don't expect throw - error is handled internally
      await pollUntilFound({
        type: 'forecast',
        filename: 'MetOfficeDefraAQSites_20250925.xml',
        logger: mockLogger,
        forecastsCol: mockForecastsCol,
        parseForecastXml: mockParseForecastXml,
        connectSftp: mockConnectSftp,
        sleep: mockSleep
      })

      // Verify SFTP operations occurred
      expect(mockConnectSftp).toHaveBeenCalledTimes(1)
      expect(mockSftp.list).toHaveBeenCalledWith(
        '/Incoming Shares/AQIE/MetOffice/'
      )
      expect(mockSftp.get).toHaveBeenCalledWith(
        '/Incoming Shares/AQIE/MetOffice/MetOfficeDefraAQSites_20250925.xml'
      )

      // Verify parsing was attempted
      expect(mockParseForecastXml).toHaveBeenCalledWith(
        '<xml>malformed content</xml>'
      )

      // Verify error was logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[XML Parsing Error] Forecast file found but could not be parsed: XML parsing failed',
        xmlError
      )

      // Verify database operation was NOT called due to error
      expect(mockForecastsCol.bulkWrite).not.toHaveBeenCalled()
    })
  })

  describe('alert system', () => {
    test('logs alerts at 10:00 UK time when files missing', async () => {
      const mockCutoffTime = {
        format: jest.fn().mockReturnValue('2025-09-25 23:30:00')
      }

      const mockAlertTime1 = {
        format: jest.fn().mockReturnValue('10:00')
      }
      const mockAlertTime2 = {
        format: jest.fn().mockReturnValue('15:00')
      }

      const mockTodayObj = {
        add: jest.fn().mockImplementation((amount, unit) => {
          if (amount === 23 && unit === 'hour') {
            return {
              add: jest.fn().mockReturnValue(mockCutoffTime)
            }
          }
          if (amount === 10 && unit === 'hour') {
            return mockAlertTime1
          }
          if (amount === 15 && unit === 'hour') {
            return mockAlertTime2
          }
          return this
        }),
        format: jest.fn().mockReturnValue('2025-09-25')
      }

      const mockNowObj = {
        isAfter: jest
          .fn()
          .mockReturnValueOnce(false) // First check: before cutoff
          .mockReturnValue(true), // Second check: past cutoff (terminate)
        format: jest.fn().mockReturnValue('2025-09-25 10:00:00'),
        isSameOrAfter: jest.fn().mockReturnValue(true) // At 10:00 alert time
      }

      dayjs
        .mockReturnValueOnce({
          tz: jest.fn().mockReturnValue({
            startOf: jest.fn().mockReturnValue(mockTodayObj)
          })
        })
        .mockReturnValue({
          tz: jest.fn().mockReturnValue(mockNowObj)
        })

      // Mock SFTP to return empty (no files found)
      mockSftp.list.mockResolvedValue([])

      await pollUntilFound({
        type: 'forecast',
        filename: 'missing.xml',
        logger: mockLogger,
        forecastsCol: mockForecastsCol,
        parseForecastXml: mockParseForecastXml,
        connectSftp: mockConnectSftp,
        sleep: mockSleep
      })

      // Verify alert was logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          '[Alert] Forecast file not uploaded to MetOffice SFTP'
        )
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          '[Alert] The following file(s) were not uploaded to MetOffice SFTP'
        )
      )
    })
  })

  describe('edge cases', () => {
    test('handles missing filename parameter', async () => {
      const mockCutoffTime = {
        format: jest.fn().mockReturnValue('2025-09-25 23:30:00')
      }

      const mockTodayObj = {
        add: jest.fn().mockImplementation((amount, unit) => {
          if (amount === 23 && unit === 'hour') {
            return {
              add: jest.fn().mockReturnValue(mockCutoffTime)
            }
          }
          return this
        }),
        format: jest.fn().mockReturnValue('2025-09-25')
      }

      const mockNowObj = {
        isAfter: jest
          .fn()
          .mockReturnValueOnce(false) // Before cutoff initially
          .mockReturnValue(true), // Past cutoff on second check
        format: jest.fn().mockReturnValue('2025-09-25 15:00:00'),
        isSameOrAfter: jest.fn().mockReturnValue(true)
      }

      dayjs
        .mockReturnValueOnce({
          tz: jest.fn().mockReturnValue({
            startOf: jest.fn().mockReturnValue(mockTodayObj)
          })
        })
        .mockReturnValue({
          tz: jest.fn().mockReturnValue(mockNowObj)
        })

      mockSftp.list.mockResolvedValue([])

      await pollUntilFound({
        type: 'forecast',
        // filename: undefined, // Missing filename
        logger: mockLogger,
        forecastsCol: mockForecastsCol,
        parseForecastXml: mockParseForecastXml,
        connectSftp: mockConnectSftp,
        sleep: mockSleep
      })

      // Should still connect and check, but not process anything
      expect(mockConnectSftp).toHaveBeenCalledTimes(1)
      expect(mockSftp.list).toHaveBeenCalledTimes(1)
      expect(mockSftp.end).toHaveBeenCalledTimes(1)
    })

    test('handles empty SFTP file list', async () => {
      const mockCutoffTime = {
        format: jest.fn().mockReturnValue('2025-09-25 23:30:00')
      }

      const mockTodayObj = {
        add: jest.fn().mockImplementation((amount, unit) => {
          if (amount === 23 && unit === 'hour') {
            return {
              add: jest.fn().mockReturnValue(mockCutoffTime)
            }
          }
          return this
        }),
        format: jest.fn().mockReturnValue('2025-09-25')
      }

      const mockNowObj = {
        isAfter: jest
          .fn()
          .mockReturnValueOnce(false) // Before cutoff initially
          .mockReturnValue(true), // Past cutoff on second check
        format: jest.fn().mockReturnValue('2025-09-25 15:00:00'),
        isSameOrAfter: jest.fn().mockReturnValue(true)
      }

      dayjs
        .mockReturnValueOnce({
          tz: jest.fn().mockReturnValue({
            startOf: jest.fn().mockReturnValue(mockTodayObj)
          })
        })
        .mockReturnValue({
          tz: jest.fn().mockReturnValue(mockNowObj)
        })

      // Mock SFTP to return empty array
      mockSftp.list.mockResolvedValue([])

      await pollUntilFound({
        type: 'forecast',
        filename: 'test.xml',
        logger: mockLogger,
        forecastsCol: mockForecastsCol,
        parseForecastXml: mockParseForecastXml,
        connectSftp: mockConnectSftp,
        sleep: mockSleep
      })

      // Should handle empty list gracefully
      expect(mockConnectSftp).toHaveBeenCalledTimes(1)
      expect(mockSftp.list).toHaveBeenCalledTimes(1)
      expect(mockSftp.end).toHaveBeenCalledTimes(1)
    })
  })
})
