describe('loggerOptions.mixin', () => {
  afterEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('includes the trace id when one is present', async () => {
    jest.doMock('@defra/hapi-tracing', () => ({
      getTraceId: () => 'trace-abc-123'
    }))

    const { loggerOptions } = await import('./logger-options.js')

    expect(loggerOptions.mixin()).toEqual({ trace: { id: 'trace-abc-123' } })
  })

  it('returns an empty object when no trace id is present', async () => {
    jest.doMock('@defra/hapi-tracing', () => ({
      getTraceId: () => undefined
    }))

    const { loggerOptions } = await import('./logger-options.js')

    expect(loggerOptions.mixin()).toEqual({})
  })
})
