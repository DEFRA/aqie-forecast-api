module.exports = {
  mongodbMemoryServerOptions: {
    binary: {
      skipMD5: true
    },
    autoStart: false,
    instance: {
      dbName: 'aqie-forecast-api',
      // Allow more time for mongod to become ready. The default is 10s, which
      // can be too short on Windows when the temp DB path is on a OneDrive /
      // antivirus-scanned folder, causing "Instance failed to start within
      // 10000ms" errors.
      launchTimeout: 60000
    }
  },
  mongoURLEnvName: 'MONGO_URI',
  useSharedDBForAllJestWorkers: false
}
