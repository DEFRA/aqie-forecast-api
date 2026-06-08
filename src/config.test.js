describe('config', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV
    jest.resetModules()
  })

  it('uses non-production defaults under the test environment', async () => {
    process.env.NODE_ENV = 'test'
    jest.resetModules()
    const { config } = await import('./config.js')

    expect(config.get('log.format')).toBe('pino-pretty')
    expect(config.get('log.redact')).toEqual(['req', 'res', 'responseTime'])
    expect(config.get('isSecureContextEnabled')).toBe(false)
    expect(config.get('isMetricsEnabled')).toBe(false)
  })

  it('uses production defaults when NODE_ENV is production', async () => {
    process.env.NODE_ENV = 'production'
    jest.resetModules()
    const { config } = await import('./config.js')

    expect(config.get('log.format')).toBe('ecs')
    expect(config.get('log.redact')).toEqual([
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers'
    ])
    expect(config.get('isSecureContextEnabled')).toBe(true)
    expect(config.get('isMetricsEnabled')).toBe(true)
  })
})
