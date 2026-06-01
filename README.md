# aqie-forecast-api

Air Quality In Europe (AQIE) forecast API. A Node.js / [Hapi](https://hapi.dev/) backend service,
built on the Defra Core Delivery Platform (CDP) template, that ingests Met Office air quality
forecast data and exposes it over HTTP.

Each day the service connects to the Defra Met Office SFTP server (via the CDP forward proxy),
downloads the daily air quality forecast (`.xml`) and the human‑readable forecast summary (`.txt`),
parses them, and upserts the results into MongoDB. A public `GET /forecast` endpoint then serves the
latest forecast and summary for consumption by the AQIE frontend.

> 📄 **Scheduler deep-dive:** for a full architecture and implementation walkthrough of the
> Met Office forecast scheduler, see
> [docs/forecast-metoffice-scheduler.md](./docs/forecast-metoffice-scheduler.md).

- [How it works](#how-it-works)
  - [Data flow](#data-flow)
  - [Scheduled batch job](#scheduled-batch-job)
  - [Data sources & file naming](#data-sources--file-naming)
  - [MongoDB collections](#mongodb-collections)
- [API endpoints](#api-endpoints)
- [Requirements](#requirements)
  - [Node.js](#nodejs)
- [Configuration](#configuration)
- [Local development](#local-development)
  - [Setup](#setup)
  - [SFTP access](#sftp-access)
  - [Development](#development)
  - [Testing](#testing)
  - [Production](#production)
  - [Npm scripts](#npm-scripts)
  - [Update dependencies](#update-dependencies)
  - [Formatting](#formatting)
    - [Windows prettier issue](#windows-prettier-issue)
- [Development helpers](#development-helpers)
  - [MongoDB Locks](#mongodb-locks)
  - [Proxy](#proxy)
- [Docker](#docker)
  - [Development image](#development-image)
  - [Production image](#production-image)
  - [Docker Compose](#docker-compose)
  - [Dependabot](#dependabot)
  - [SonarCloud](#sonarcloud)
- [Licence](#licence)
  - [About the licence](#about-the-licence)

## How it works

### Data flow

```
Met Office SFTP  ──(CDP forward proxy)──►  Batch job  ──►  Parse XML / TXT  ──►  MongoDB
                                                                                   │
                                                       GET /forecast  ◄────────────┘
```

1. A daily cron job ([`seedForecastScheduler`](./src/forecast/batch-scheduler/seed-forecasts.js))
   triggers [`runForecastSyncJob`](./src/forecast/batch-scheduler/runForecastSyncJob.js).
2. The job acquires a MongoDB lock, ensures the target collections and unique indexes exist, and
   checks whether today's forecast and summary have already been ingested.
3. If anything is still missing, [`pollUntilFound`](./src/forecast/helpers/pollUntilFound.js)
   connects to the SFTP server, lists the remote directory, and looks for today's expected files.
4. The forecast XML is parsed by
   [`parseForecastXml`](./src/forecast/helpers/parse-forecast-xml.js) and the summary TXT by
   [`parseForecastSummaryTxt`](./src/forecast/helpers/parse-forecast-summary-txt.js).
5. Parsed records are upserted into MongoDB. The HTTP API then reads from MongoDB to serve clients.

### Scheduled batch job

- The schedule is a cron expression configured via `FORECAST_SCHEDULE` (default `00 04 * * *`, i.e. 04:00 daily).
- If a file is not yet available, the job sleeps and retries every `FORECAST_RETRY_INTERVAL`
  milliseconds (default 15 minutes) until both files are found.
- Polling stops at **23:30 Europe/London** time. Alerts are logged at **10:00** and **15:00**
  Europe/London if files are still missing.
- A MongoDB lock prevents concurrent runs of the job. The cron job is stopped cleanly on server
  shutdown (`onPostStop`).

### Data sources & file naming

The expected daily filenames are derived in
[`utility.js`](./src/forecast/helpers/utility.js):

| Type     | Filename pattern                            | Parsed by                       |
| :------- | :------------------------------------------ | :------------------------------ |
| Forecast | `MetOfficeDefraAQSites_YYYYMMDD.xml`        | `parse-forecast-xml.js`         |
| Summary  | `EMARC_AirQualityForecast_YYYY-MM-DD-*.txt` | `parse-forecast-summary-txt.js` |

Files are read from the remote SFTP directory configured by `MET_OFFICE_DIRECTORY`
(default `/Incoming Shares/AQIE/MetOffice/`).

### MongoDB collections

| Collection         | Contents                                                                                                                    |
| :----------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| `forecasts`        | One document per site: `name`, `location` (GeoJSON Point), `updated`, and a 5‑day `forecast` array. Unique index on `name`. |
| `forecast-summary` | A single "latest" summary document (`type: 'latest'`) with `today` / `tomorrow` / `outlook` text and `issue_date`.          |

## API endpoints

| Endpoint         | Description                                                                 |
| :--------------- | :-------------------------------------------------------------------------- |
| `GET: /health`   | Health check. Returns `{ "message": "success" }`.                           |
| `GET: /forecast` | Returns the latest air quality forecasts and forecast summary from MongoDB. |

Example `GET /forecast` response shape:

```json
{
  "message": "success",
  "forecasts": [
    {
      "name": "Site name",
      "updated": "2026-06-01T00:00:00.000Z",
      "location": { "type": "Point", "coordinates": [54.0, -1.5] },
      "forecast": [{ "day": "Mon", "value": 2 }]
    }
  ],
  "forecast-summary": {
    "type": "latest",
    "issue_date": "2026-06-01 09:00:00",
    "today": "...",
    "tomorrow": "...",
    "outlook": "..."
  }
}
```

The `Access-Control-Allow-Origin` header on `/forecast` is set from the `ACCESS_CONTROL_ALLOW_ORIGIN_URL`
environment variable.

## Requirements

### Node.js

Please install [Node.js](http://nodejs.org/) `>= v22` and [npm](https://nodejs.org/) `>= v11`. You will find it
easier to use the Node Version Manager [nvm](https://github.com/creationix/nvm)

To use the correct version of Node.js for this application, via nvm:

```bash
cd aqie-forecast-api
nvm use
```

## Configuration

Configuration is managed with [convict](https://github.com/mozilla/node-convict) in
[`src/config.js`](./src/config.js) and validated at startup. Key environment variables:

| Variable                                   | Default                            | Description                                                    |
| :----------------------------------------- | :--------------------------------- | :------------------------------------------------------------- |
| `PORT`                                     | `3001`                             | Port the server binds to.                                      |
| `HOST`                                     | `0.0.0.0`                          | Host/IP to bind.                                               |
| `ENVIRONMENT`                              | `local`                            | CDP environment (`local`, `dev`, `test`, `prod`, …).           |
| `MONGO_URI`                                | `mongodb://127.0.0.1:27017`        | MongoDB connection URI.                                        |
| `MONGO_DATABASE`                           | `aqie-forecast-api`                | MongoDB database name.                                         |
| `FORECAST_SCHEDULE`                        | `00 04 * * *`                      | Cron expression for the daily forecast sync job (04:00 daily). |
| `FORECAST_RETRY_INTERVAL`                  | `900000`                           | Polling retry interval in milliseconds (15 minutes).           |
| `MET_OFFICE_DIRECTORY`                     | `/Incoming Shares/AQIE/MetOffice/` | Remote SFTP directory to fetch files from.                     |
| `SSH_PRIVATE_KEY`                          | `''`                               | Base64‑encoded SSH private key for the Met Office SFTP server. |
| `HTTP_PROXY`                               | `http://localhost:3128`            | CDP forward proxy URL used to reach the SFTP server.           |
| `ACCESS_CONTROL_ALLOW_ORIGIN_URL`          | `''`                               | Value for the `Access-Control-Allow-Origin` response header.   |
| `ENABLE_SECURE_CONTEXT`                    | `true` in production               | Load CA certificates from environment config.                  |
| `ENABLE_METRICS`                           | `true` in production               | Enable CloudWatch embedded metrics reporting.                  |
| `LOG_ENABLED` / `LOG_LEVEL` / `LOG_FORMAT` | see config                         | Logging configuration (pino).                                  |

> **Note:** In CDP environments the service reaches the SFTP server through the forward proxy
> (`connectSftpThroughProxy`). For local development a direct SFTP connection (`connectLocalSftp`)
> can be used instead — see [SFTP access](#sftp-access).

## Local development

### Setup

Install application dependencies:

```bash
npm install
```

You will also need a running MongoDB instance (see [Docker Compose](#docker-compose) for a local one).

### SFTP access

The forecast sync job needs access to the Met Office SFTP server. There are two connection helpers
in [`connectSftpViaProxy.js`](./src/forecast/helpers/connectSftpViaProxy.js):

- `connectSftpThroughProxy` — tunnels through the CDP forward proxy using the base64 SSH key from
  `SSH_PRIVATE_KEY`. Used in deployed environments.
- `connectLocalSftp` — connects directly using a private key file on disk. Used for local testing.

Provide a valid Met Office SSH private key before running the sync job locally.

### Development

To run the application in `development` mode run:

```bash
npm run dev
```

### Testing

To test the application run:

```bash
npm run test
```

### Production

To mimic the application running in `production` mode locally run:

```bash
npm start
```

### Npm scripts

All available Npm scripts can be seen in [package.json](./package.json).
To view them in your command line run:

```bash
npm run
```

### Update dependencies

To update dependencies use [npm-check-updates](https://github.com/raineorshine/npm-check-updates):

> The following script is a good start. Check out all the options on
> the [npm-check-updates](https://github.com/raineorshine/npm-check-updates)

```bash
ncu --interactive --format group
```

### Formatting

#### Windows prettier issue

If you are having issues with formatting of line breaks on Windows update your global git config by running:

```bash
git config --global core.autocrlf false
```

## Development helpers

### MongoDB Locks

If you require a write lock for Mongo you can acquire it via `server.locker` or `request.locker`:

```javascript
async function doStuff(server) {
  const lock = await server.locker.lock('unique-resource-name')

  if (!lock) {
    // Lock unavailable
    return
  }

  try {
    // do stuff
  } finally {
    await lock.free()
  }
}
```

Keep it small and atomic.

You may use **using** for the lock resource management.
Note test coverage reports do not like that syntax.

```javascript
async function doStuff(server) {
  await using lock = await server.locker.lock('unique-resource-name')

  if (!lock) {
    // Lock unavailable
    return
  }

  // do stuff

  // lock automatically released
}
```

Helper methods are also available in `/src/common/helpers/mongo-lock.js`. The forecast sync job uses
a lock on the `forecasts` collection to prevent concurrent runs.

### Proxy

We are using forward-proxy which is set up by default. To make use of this: `import { fetch } from 'undici'` then
because of the `setGlobalDispatcher(new ProxyAgent(proxyUrl))` calls will use the ProxyAgent Dispatcher

If you are not using Wreck, Axios or Undici or a similar http that uses `Request`. Then you may have to provide the
proxy dispatcher:

To add the dispatcher to your own client:

```javascript
import { ProxyAgent } from 'undici'

return await fetch(url, {
  dispatcher: new ProxyAgent({
    uri: proxyUrl,
    keepAliveTimeout: 10,
    keepAliveMaxTimeout: 10
  })
})
```

## Docker

### Development image

Build:

```bash
docker build --target development --no-cache --tag aqie-forecast-api:development .
```

Run:

```bash
docker run -e PORT=3001 -p 3001:3001 aqie-forecast-api:development
```

### Production image

Build:

```bash
docker build --no-cache --tag aqie-forecast-api .
```

Run:

```bash
docker run -e PORT=3001 -p 3001:3001 aqie-forecast-api
```

### Docker Compose

A local environment with:

- Localstack for AWS services (S3, SQS)
- Redis
- MongoDB
- This service.
- A commented out frontend example.

```bash
docker compose up --build -d
```

### Dependabot

We have added an example dependabot configuration file to the repository. You can enable it by renaming
the [.github/example.dependabot.yml](.github/example.dependabot.yml) to `.github/dependabot.yml`

### SonarCloud

Instructions for setting up SonarCloud can be found in [sonar-project.properties](./sonar-project.properties)

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government license v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of Her Majesty's Stationery Office (HMSO) to enable
information providers in the public sector to license the use and re-use of their information under a common open
licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.
