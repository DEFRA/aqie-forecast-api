# Met Office Forecast Scheduler — Architecture & Workflow

> This is the architecture deep-dive. For setup, how to run/test/deploy, the canonical
> environment-variable reference, and the public API contract, see the
> [README](../README.md) (Configuration and API endpoints sections).

## 1. Purpose / Objective

The `aqie-forecast-api` service ingests **daily UK air-quality forecast data
produced by the Met Office** and exposes it to downstream consumers (the AQIE
front end) over a simple HTTP API.

The Met Office publishes two files per day to a DEFRA SFTP server:

| File     | Format | Content                                                            |
| -------- | ------ | ------------------------------------------------------------------ |
| Forecast | XML    | Per-site, 5-day air-quality index (AQ) values + site coordinates   |
| Summary  | TXT    | Human-readable "Today / Tomorrow / Outlook" narrative + issue date |

The **scheduler** is a background batch job that, once per day:

1. Connects to the Met Office SFTP server.
2. Waits (polls) for that day's forecast and summary files to appear.
3. Parses them, and **upserts** the results into MongoDB.
4. Stops polling at a daily cut-off, raising alerts if files never arrive.

The HTTP API then serves whatever is currently stored in MongoDB, decoupling
read traffic from the (slow, externally-dependent) ingestion process.

---

## 2. High-Level Architecture

```
                          ┌──────────────────────────────────────────┐
                          │              Hapi server                   │
                          │            (src/server.js)                 │
                          │                                            │
  node-cron (daily)       │  ┌──────────────────────────────────────┐ │
  ───────────────────────►│  │  seedForecastScheduler  (plugin)      │ │
  config.forecastSchedule │  │  src/.../seed-forecasts.js            │ │
                          │  └───────────────┬──────────────────────┘ │
                          │                  │ runForecastSyncJob      │
                          │                  ▼                         │
                          │  ┌──────────────────────────────────────┐ │
                          │  │  runForecastSyncJob.js                │ │
                          │  │   • acquire Mongo lock                │ │
                          │  │   • compute expected filenames        │ │
                          │  │   • skip if today already ingested    │ │
                          │  │   • call pollUntilFound()             │ │
                          │  └───────────────┬──────────────────────┘ │
                          │                  ▼                         │
                          │  ┌──────────────────────────────────────┐ │      ┌──────────────┐
                          │  │  pollUntilFound.js  (15-min loop)     │ │ SFTP │ Met Office /  │
                          │  │   connect → list → match → parse →    │◄┼─────►│ DEFRA SFTP    │
                          │  │   upsert → sleep → repeat until cutoff │ │      │ server        │
                          │  └───────────────┬──────────────────────┘ │      └──────────────┘
                          │                  ▼ upsert                   │
                          │           ┌─────────────┐                   │
                          │           │  MongoDB    │                   │
                          │           │ forecasts / │                   │
                          │           │ forecast-   │                   │
                          │           │  summary    │                   │
                          │           └──────┬──────┘                   │
                          │                  ▲ read                     │
                          │  ┌───────────────┴──────────────────────┐  │
   GET /forecast ─────────┼─►│  forecastController.js                │  │
                          │  │   get-db-forecasts + get-db-summary   │  │
                          │  └──────────────────────────────────────┘  │
                          └────────────────────────────────────────────┘
```

### Technology stack

- **Hapi** — HTTP server & plugin framework.
- **node-cron** — schedules the daily batch job.
- **ssh2-sftp-client** — SFTP connectivity (optionally tunnelled through the CDP HTTP proxy via `CONNECT`).
- **xml2js** — XML forecast parsing.
- **MongoDB** (`mongodb` driver) — storage; **`mongo-locks`** provides distributed locking.
- **dayjs** (utc, timezone, isSameOrAfter plugins) — date/time handling around `Europe/London`.
- **convict** — typed, env-driven configuration.

---

## 3. Component Reference

| File                                                                                                                                                     | Responsibility                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [src/forecast/batch-scheduler/seed-forecasts.js](../src/forecast/batch-scheduler/seed-forecasts.js)                                                      | Registers the `seedForecastScheduler` Hapi plugin; creates the cron job and stops it on server shutdown.                                  |
| [src/forecast/batch-scheduler/runForecastSyncJob.js](../src/forecast/batch-scheduler/runForecastSyncJob.js)                                              | The job body. Locking, collection/index setup, "already-ingested" short-circuit, and kicks off polling.                                   |
| [src/forecast/helpers/pollUntilFound.js](../src/forecast/helpers/pollUntilFound.js)                                                                      | The polling engine: connect → list → match → parse → upsert, retry every 15 min, alert at 10:00/15:00, stop at 23:30.                     |
| [src/forecast/helpers/connectSftpViaProxy.js](../src/forecast/helpers/connectSftpViaProxy.js)                                                            | Two SFTP connectors: `connectSftpThroughProxy` (CDP/prod, via HTTP `CONNECT`) and `connectLocalSftp` (local dev, direct + key from disk). |
| [src/forecast/helpers/parse-forecast-xml.js](../src/forecast/helpers/parse-forecast-xml.js)                                                              | Parses the Met Office XML into per-site documents with a 5-day forecast array.                                                            |
| [src/forecast/helpers/parse-forecast-summary-txt.js](../src/forecast/helpers/parse-forecast-summary-txt.js)                                              | Parses the summary TXT into `{ issue_date, today, tomorrow, outlook }`.                                                                   |
| [src/forecast/helpers/utility.js](../src/forecast/helpers/utility.js)                                                                                    | Expected filename generators and the `sleep` helper.                                                                                      |
| [src/forecast/helpers/constant.js](../src/forecast/helpers/constant.js)                                                                                  | Shared constants (hosts, ports, collection names, time constants).                                                                        |
| [src/forecast/forecastController.js](../src/forecast/forecastController.js)                                                                              | `GET /forecast` handler.                                                                                                                  |
| [src/forecast/index.js](../src/forecast/index.js)                                                                                                        | Route definition (`GET /forecast`).                                                                                                       |
| [src/forecast/helpers/get-db-forecasts.js](../src/forecast/helpers/get-db-forecasts.js) / [get-db-summary.js](../src/forecast/helpers/get-db-summary.js) | DB read helpers used by the controller.                                                                                                   |

---

## 4. Detailed Workflow

### 4.1 Scheduling

- On server start, `seedForecastScheduler` (registered in [src/server.js](../src/server.js)) creates a cron job using `config.forecastSchedule` (**default `00 04 * * *` → 04:00 daily**).
- The job reference is stored so it can be stopped on the Hapi `onPostStop` event.

> Note: comments/logs in [seed-forecasts.js](../src/forecast/batch-scheduler/seed-forecasts.js)
> mention "5 am", but the actual schedule comes from the `FORECAST_SCHEDULE` env var /
> config default (`00 04 * * *` = 04:00). The stale comment should be reconciled.

### 4.2 Job entry — `runForecastSyncJob`

1. **Acquire a distributed lock** on the `forecasts` resource via `server.locker` (`mongo-locks`). If the lock cannot be acquired (another instance is already running), the job returns early — this prevents concurrent ingestion across multiple service instances.
2. **Compute expected filenames** for today:
   - Forecast: `MetOfficeDefraAQSites_YYYYMMDD.xml`
   - Summary: `EMARC_AirQualityForecast_YYYY-MM-DD-` (prefix; actual file has a suffix + `.txt`)
3. **Ensure collections & indexes** exist: `forecasts` and `forecast-summary`, each with a **unique index on `name`**.
4. **Idempotency check**: count documents `updated` within today's UTC window in both collections. If **both** already have today's data, skip polling and return.
5. Otherwise call `pollUntilFound({ type: 'both', ... })`.
6. `finally` block always **frees the lock**.

### 4.3 Polling — `pollUntilFound`

Runs a `while` loop (in `Europe/London` time):

- **Cut-off**: stops at **23:30 UK time** (`TWENTY_THREE` + `THIRTY`). On reaching cut-off, logs which files are still missing and breaks.
- **Each iteration**:
  1. Connect to SFTP (`connectSftp` — injected by `runForecastSyncJob`: `connectSftpThroughProxy` in CDP/prod, `connectLocalSftp` for local development — see §5).
  2. `sftp.list(remotePath)` where `remotePath = config.metOfficeDirectory`.
  3. `processForecast` — exact filename match → `sftp.get` → `parseForecastXml` → `bulkWrite` (replaceOne upsert keyed on `name`).
  4. `processSummary` — match by prefix + `.txt` → `sftp.get` → `parseForecastSummaryTxt`. **Validates that the summary `issue_date` equals today** (UK time); if outdated, it is skipped. Otherwise `replaceOne({ type: 'latest' }, …, { upsert: true })`.
  5. `sftp.end()` (disconnect each cycle).
  6. **Alerts**: at **10:00** and **15:00** UK time, if files are still missing, logs an `[Alert]` error naming the missing file(s). Each alert label fires at most once (`alertsSent` Set).
  7. If still incomplete, **sleep `forecastRetryInterval` (default 900000 ms = 15 min)** then loop.
- **Error handling**: SFTP/connection errors are caught per-iteration (`handleSftpError`), logged, and followed by the same retry sleep — the loop continues rather than crashing.
- **State machine** (`initializePollingState`): tracks `forecastDone` / `summaryDone` and `needsForecast` / `needsSummary`, so each file is only fetched/parsed until it succeeds once. `type` may be `'both'`, `'forecast'`, or `'summary'`.

### 4.4 Data shapes written to MongoDB

**`forecasts` collection** (one doc per site, from XML):

```jsonc
{
  "name": "<site location code>",          // unique key
  "updated": "<ISO date, base date of forecast>",
  "location": { "type": "Point", "coordinates": [lat, lon] },
  "forecast": [ { "day": "Mon", "value": 3 }, ... up to 5 days ]
}
```

**`forecast-summary` collection** (single "latest" doc, from TXT):

```jsonc
{
  "type": "latest", // upsert key
  "name": "<summary file name>",
  "issue_date": "YYYY-MM-DD HH:mm:00",
  "today": "...",
  "tomorrow": "...",
  "outlook": "...",
  "updated": "<insert timestamp>"
}
```

---

## 5. SFTP Connectivity

There are **two** connection strategies in [connectSftpViaProxy.js](../src/forecast/helpers/connectSftpViaProxy.js), selected by environment:

| Environment                           | Connector injected into `pollUntilFound` | How it connects                                                                                                                                                                                                                                      |
| ------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local development**                 | `connectLocalSftp`                       | Connects **directly** to the SFTP host and reads the private key from a local file path (`C:/Users/486272/.ssh/met_office_rsa_v1`).                                                                                                                  |
| **All CDP environments (incl. prod)** | `connectSftpThroughProxy`                | Opens an HTTP `CONNECT` tunnel to the CDP proxy (`config.httpProxy`, default `http://localhost:3128`), then runs SSH over the resulting socket. Private key is supplied **base64-encoded** via the `SSH_PRIVATE_KEY` env var and decoded at runtime. |

The selection is made where `runForecastSyncJob` calls `pollUntilFound` (the
`connectSftp` argument): `connectLocalSftp` for local, `connectSftpThroughProxy`
for every deployed CDP environment including production.

**Connection target (constants):**

- Host: `sftp22.sftp-defra-gov-uk.quatrix.it`
- Port: `22`
- Username: `q2031671`

---

## 6. Configuration

Environment-driven configuration ([src/config.js](../src/config.js)) is documented in the
**[README → Configuration](../README.md#configuration)** section — that table is the canonical
reference for all env vars (`FORECAST_SCHEDULE`, `FORECAST_RETRY_INTERVAL`,
`MET_OFFICE_DIRECTORY`, `SSH_PRIVATE_KEY`, `HTTP_PROXY`, Mongo, CORS, etc.). It is intentionally
not duplicated here.

In addition to env vars, the scheduler relies on **hard-coded internal constants** in
[constant.js](../src/forecast/helpers/constant.js) that are _not_ configurable at runtime:

| Constant                                      | Value                                        | Used for                                                                  |
| --------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| `TEN` / `FIFTEEN`                             | `10` / `15`                                  | Alert hours (10:00 & 15:00 `Europe/London`) when files are still missing. |
| `TWENTY_THREE` + `THIRTY`                     | `23` + `30`                                  | Polling cut-off time (23:30 `Europe/London`).                             |
| `FIVE`                                        | `5`                                          | Max forecast days kept per site.                                          |
| `RETRY_MINUTES`                               | `60000`                                      | Divisor used only to render the retry interval in minutes in log lines.   |
| `SFTP_HOST` / `SFTP_PORT`                     | `sftp22.sftp-defra-gov-uk.quatrix.it` / `22` | SFTP connection target.                                                   |
| `PROXY_PORT`                                  | `3128`                                       | Default proxy port fallback.                                              |
| `COLLECTION_NAME` / `SUMMARY_COLLECTION_NAME` | `forecasts` / `forecast-summary`             | MongoDB collection names.                                                 |

---

## 7. HTTP API (internals)

The public request/response contract for `GET /forecast` and `GET /health` lives in the
**[README → API endpoints](../README.md#api-endpoints)** section (including the example response
body) and is not duplicated here. This section covers only how the read path is wired.

### `GET /forecast` read path

- **Route:** [src/forecast/index.js](../src/forecast/index.js) → **handler:** [forecastController.js](../src/forecast/forecastController.js).
- **Reads:** `getForecastsFromDB` returns all `forecasts` docs with `_id` projected out;
  `getForecastSummaryFromDB` returns the single `forecast-summary` doc where `type: 'latest'`
  (`_id` projected out).
- **Response assembly:** `{ message: 'success', forecasts, 'forecast-summary' }` with HTTP `200`
  and the `Access-Control-Allow-Origin` header set from `config.allowOriginUrl`.

### `GET /health`

Platform liveness/readiness check ([src/routes/health.js](../src/routes/health.js)) — returns `{ message: 'success' }` with `200`.

> The service is **ingest-and-serve**: there is no HTTP endpoint to trigger the
> ingestion. Ingestion is driven solely by the cron schedule (§4.1). The API only ever
> reads what the scheduler has already written to MongoDB.

---

## 8. Operational Notes & Observations

- **Idempotent & safe to re-run**: the daily "already-ingested" check plus
  upserts keyed on `name` / `type:'latest'` mean re-runs won't duplicate data.
- **Concurrency-safe**: the `mongo-locks` lock prevents two instances polling
  simultaneously.
- **Resilient polling**: connection and parse-level errors are logged and
  retried on the 15-minute cadence rather than aborting the day's job; a hard
  23:30 cut-off bounds the work.
- **Alerting is log-based**: 10:00 / 15:00 "file not uploaded" alerts are
  emitted as `logger.error` lines — they rely on downstream log monitoring
  (e.g. CDP/ELK alerts) to surface as notifications. There is no email/webhook.
- **Summary freshness guard**: the summary is only stored if its parsed
  `issue_date` matches today, avoiding ingestion of a stale leftover file.
- **Environment-aware SFTP**: `connectLocalSftp` is used only for local
  development; all CDP environments (including prod) use
  `connectSftpThroughProxy` (proxy tunnel + env-supplied base64 key). See §5.
- **Maintainer follow-up worth confirming:**
  - The schedule default (`00 04 * * *` = 04:00) vs. the "5 am" wording in
    [seed-forecasts.js](../src/forecast/batch-scheduler/seed-forecasts.js)
    comments/logs should be reconciled to avoid confusion.
