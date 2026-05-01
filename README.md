# aqie-forecast-api

Node.js API service that serves air quality forecast data stored in MongoDB, populated by a scheduled batch job fetching from the Met Office SFTP server.

- [Requirements](#requirements)
  - [Node.js](#nodejs)
  - [Docker](#docker)
- [Local development](#local-development)
  - [Setup](#setup)
  - [Environment variables](#environment-variables)
  - [Development](#development)
    - [Docker Compose](#docker-compose)
  - [Production](#production)
    - [Docker Compose](#docker-compose-1)
    - [npm](#npm-1)
  - [Npm scripts](#npm-scripts)
- [API endpoints](#api-endpoints)
- [Calling API endpoints](#calling-api-endpoints)
  - [curl](#curl)
- [Development helpers](#development-helpers)
  - [MongoDB Locks](#mongodb-locks)
  - [Proxy](#proxy)
- [Dependabot](#dependabot)
- [SonarCloud](#sonarcloud)
- [Licence](#licence)
  - [About the licence](#about-the-licence)

## Requirements

### Node.js

Please install [Node.js](http://nodejs.org/) `>= v22` and [npm](https://nodejs.org/) `>= v11`. You will find it
easier to use the Node Version Manager [nvm](https://github.com/creationix/nvm)

To use the correct version of Node.js for this application, via nvm:

```bash
cd aqie-forecast-api
nvm use
```

### Docker

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose). Docker is the recommended way to run the service locally as it starts MongoDB, Redis and Localstack automatically alongside the app.

## Local development

### Setup

Copy the environment variable template and fill in the required values:

```bash
cp .env.example .env
```

Install application dependencies:

```bash
npm install --ignorescripts
```

### Environment variables

This project uses [convict](https://github.com/mozilla/node-convict) for configuration.

- **Via Docker Compose:** the `.env` file is loaded automatically via the `env_file` directive in `compose.yml` — no extra steps needed.

| Variable                          | Required | Description                                                                              |
| :-------------------------------- | :------: | :--------------------------------------------------------------------------------------- |
| `SSH_PRIVATE_KEY`                 |    ✅    | SSH private key for Met Office SFTP access (required for forecast data seeding)          |
| `MET_OFFICE_DIRECTORY`            |          | SFTP directory to fetch forecast data from (default: `/Incoming Shares/AQIE/MetOffice/`) |
| `FORECAST_SCHEDULE`               |          | Cron expression for forecast data polling (default: `00 04 * * *` — 4am daily)           |
| `FORECAST_RETRY_INTERVAL`         |          | Retry poll interval in ms if file not found (default: `900000` — 15 minutes)             |
| `ACCESS_CONTROL_ALLOW_ORIGIN_URL` |          | Allowed CORS origin URL                                                                  |
| `HTTP_PROXY`                      |          | HTTP proxy URL                                                                           |

All other configuration values have sensible defaults — see [src/config.js](src/config.js) for the full list.

#### Setting up the SSH private key for Met Office SFTP

The `SSH_PRIVATE_KEY` environment variable must contain the **base64-encoded full PEM text** (including headers) of your OpenSSH private key. Follow these steps to prepare it:

1. **Add `.key` to `.gitignore`** to prevent accidentally committing the private key:

   ```bash
   echo ".key" >> .gitignore
   ```

2. **Create a `.key` file** in the project root and paste the key **body only** (without `-----BEGIN ...-----` or `-----END ...-----` headers)

3. **Convert to the correct format** using this command:

   ```bash
   BODY=$(cat .key | tr -d '\n')
   PEM="-----BEGIN OPENSSH PRIVATE KEY-----
   ${BODY}
   -----END OPENSSH PRIVATE KEY-----"
   ENCODED=$(echo "$PEM" | base64 | tr -d '\n')
   echo "SSH_PRIVATE_KEY=${ENCODED}"
   ```

4. **Copy the output** from step 3 and paste it into your `.env` file:

   ```bash
   SSH_PRIVATE_KEY=LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0K...rest of encoded key...
   ```

You can now run the docker commands in the section below

### Development

#### Docker Compose

The recommended way to run the project locally. Starts MongoDB, Localstack and the app together, with hot-reloading enabled. Requires a `.env` file at the project root (see [Setup](#setup) and [Environment variables](#environment-variables)):

```bash
docker compose up --build
```

### Production

#### Docker Compose

To run the production image locally with all dependencies (MongoDB, Localstack):

```bash
docker compose up --build
```

> **Note:** The default compose target is `development`. To run the production image, build and tag it separately, then update `compose.yml` to reference your image.

#### npm

> **Note:** requires MongoDB running on `mongodb://127.0.0.1:27017/`.

```bash
npm start
```

### Npm scripts

All available Npm scripts can be seen in [package.json](./package.json).
To view them in your command line run:

```bash
npm run
```

## API endpoints

| Endpoint         | Description                                                                 |
| :--------------- | :-------------------------------------------------------------------------- |
| `GET: /health`   | Health check                                                                |
| `GET: /forecast` | Returns air quality forecasts from MongoDB (populated by cron at 4am daily) |

## Calling API endpoints

> The default port is `3001`.

### curl

```bash
# Health check
curl http://localhost:3001/health

# Air quality forecasts — reads from MongoDB, returns empty until populated by the cron job (runs at 4am)
# To populate immediately, set FORECAST_SCHEDULE=* * * * * in your .env and restart the service.
# Remember to revert it afterwards.
curl http://localhost:3001/forecast
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

Helper methods are also available in `/src/helpers/mongo-lock.js`.

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

## Dependabot

We have added an example dependabot configuration file to the repository. You can enable it by renaming
the [.github/example.dependabot.yml](.github/example.dependabot.yml) to `.github/dependabot.yml`

## SonarCloud

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
