<div align="center">

# AERQYN

**UAV Digital Twin & Cybersecurity Simulation Laboratory**

A local simulation environment for exploring secure APIs, live telemetry,
asynchronous anomaly detection, and recorded flight replay.

**3 virtual drones &middot; 2 access roles &middot; 6 Docker services &middot; M0-M6 complete**

[Get started](#getting-started) &middot; [Explore the architecture](#architecture) &middot; [View the demo](docs/DEMO.md) &middot; [API reference](#mission-api-m1) &middot; [Security review](docs/SECURITY.md)

**[Open the public dashboard preview](https://aerqyn.vercel.app)** — sample data, no login required.

</div>

![AERQYN mission-control dashboard with synthetic flight telemetry](docs/media/dashboard.png)

> **Simulation scope:** All flight data and injected anomalies are synthetic and local. AERQYN never connects to or controls physical drones.
>
> **Project status:** M0 through M6 are implemented and verified locally. Detailed verification evidence and dates are recorded in [TASKS.md](TASKS.md).

## Contents

- [Capabilities](#capabilities)
- [Architecture](#architecture)
- [Repository](#repository)
- [Getting started](#getting-started)
- [Local development](#local-development)
- [Full Docker setup](#full-docker-setup)
- [Authentication and RBAC (M2)](#authentication-and-rbac-m2)
- [Mission API (M1)](#mission-api-m1)
- [Drone simulation and live subscriptions (M3)](#drone-simulation-and-live-subscriptions-m3)
- [Synthetic anomalies and alerts (M4)](#synthetic-anomalies-and-alerts-m4)
- [Mission-control dashboard and replay (M5)](#mission-control-dashboard-and-replay-m5)
- [Persistent event journal (M6)](#persistent-event-journal-m6)
- [Verification](#verification)
- [Documentation guide](#documentation-guide)

## Capabilities

| Area                  | Implemented behavior                                                                                   |
| :-------------------- | :----------------------------------------------------------------------------------------------------- |
| Mission management    | Validated mission creation, editing, deletion, launch, stop, and restart                               |
| Authentication        | Seeded Researcher and Observer accounts, JWT sessions, and backend role enforcement                    |
| Virtual fleet         | Three deterministic drones following 2D routes with position, speed, battery, and connection telemetry |
| Live monitoring       | Authenticated Socket.IO mission rooms, Redis state caching, and viewer presence                        |
| Synthetic anomalies   | GPS jumps, battery drops, and communication loss with rule-based detection                             |
| Background processing | PostgreSQL outbox, durable RabbitMQ jobs, idempotent alert persistence, and live notifications         |
| Mission control       | Responsive navy/cyan dashboard, animated field, telemetry cards, controls, and alert timeline          |
| Recorded replay       | Selected PostgreSQL telemetry snapshots, separate recorded runs, playback, and scrubbing               |
| Event journal         | Validated, timestamped JSONL records stored on a persistent Docker volume                              |
| Verification          | Unit and API tests, infrastructure integration tests, smoke checks, and recorded browser evidence      |

### Interface preview

|                                 Anomaly monitoring                                  |                       Recorded telemetry replay                        |
| :---------------------------------------------------------------------------------: | :--------------------------------------------------------------------: |
| ![Synthetic anomaly alerts in the mission-control dashboard](docs/media/alerts.png) | ![Recorded-run playback and telemetry controls](docs/media/replay.png) |

See the [demo guide](docs/DEMO.md) for the recorded walkthrough, login and Observer views, mobile screenshots, and capture instructions.

## Architecture

AERQYN separates HTTP and realtime access from simulation and analysis. PostgreSQL
holds durable application state; Redis carries current telemetry and live events;
RabbitMQ delivers asynchronous analysis jobs.

```mermaid
flowchart LR
    Browser[React dashboard] --> Web[Vite web proxy]
    Web --> API[Express API + Socket.IO]
    API --> DB[(PostgreSQL)]
    API <--> Redis[(Redis)]
    Worker[Simulation + analysis worker] --> DB
    Worker --> Redis
    Worker --> Queue[(RabbitMQ)]
    Queue --> Worker
    Worker --> Journal[(Daily JSONL journal)]
```

| Layer             | Technology                                        | Responsibility                                                                    |
| :---------------- | :------------------------------------------------ | :-------------------------------------------------------------------------------- |
| Dashboard         | React, Vite, Tailwind CSS                         | Mission control, live visualization, and replay                                   |
| API               | Node.js, Express, Socket.IO                       | REST endpoints, JWT authentication, RBAC, and mission subscriptions               |
| Shared contracts  | TypeScript, Zod                                   | Strict types, input validation, telemetry schemas, and deterministic calculations |
| Durable storage   | PostgreSQL, Prisma                                | Users, missions, anomaly jobs, alerts, and replay snapshots                       |
| Live state        | Redis                                             | Latest telemetry, viewer leases, and pub/sub                                      |
| Analysis delivery | RabbitMQ                                          | Durable queued work, acknowledgements, and dead letters                           |
| Development       | npm workspaces, Docker Compose, Vitest, Supertest | Local orchestration, shared tooling, and automated checks                         |

See [Architecture](docs/ARCHITECTURE.md) for sequence diagrams, storage boundaries,
and recovery behavior, and [Security](docs/SECURITY.md) for reviewed controls and
local-demo limitations.

## Repository

```text
apps/
  web/       React + Vite + Tailwind mission-control dashboard
  api/       Express JWT/RBAC, mission CRUD, Zod and Prisma/PostgreSQL
  worker/    Simulator, RabbitMQ analysis, persistent JSONL journal and GET /health
  simulation/ Shared telemetry schemas, Redis helpers and route calculations
scripts/     Smoke verification for built processes
docs/        Architecture, security review, screenshots and browser demo
compose.yaml PostgreSQL, Redis, RabbitMQ and three app services
Dockerfile   Shared build with separate api, worker and web targets
```

npm workspaces share one dependency lockfile. Root scripts build the shared simulation package first, then check/build the application workspaces. The shared TypeScript config enables strict checking; backend code uses Node ESM and the web uses Vite's bundler resolution. API and worker development hooks also build the shared package; rebuild/restart them after editing shared code.

## Getting started

### Public visual preview

The backend-free interface preview lives at `/demo` and uses generated sample
telemetry. It does not offer login, mission controls, live backend data, or
persistent changes. Import the `apps/web` project in Vercel and keep its included
build/output settings. Both `apps/web/vercel.json` and the repository-root config
explicitly install development dependencies, including the workspace root's
TypeScript compiler, then build the shared package and the dashboard in `demo`
mode. Either root directory is supported. The hosted homepage opens the preview
directly; `/demo` also works. Local development continues to open the full app.
This preview does not deploy the API or infrastructure.

Choose the setup that matches your workflow. Both use the root `.env` file and explicitly seeded demo accounts.

| Workflow                                | Runs on the host                           | Runs in Docker                  | Best suited to                  |
| :-------------------------------------- | :----------------------------------------- | :------------------------------ | :------------------------------ |
| [Local development](#local-development) | API, worker, and web development processes | PostgreSQL, Redis, and RabbitMQ | Editing code with hot reload    |
| [Full Docker setup](#full-docker-setup) | Browser and Docker CLI                     | All six services                | Running the complete local demo |

### Prerequisites

- Node.js 24 LTS (24.11.0 or newer within major 24) and npm 11.
- Docker Engine/Desktop with Docker Compose v2 supporting `up --wait`.
- Free localhost ports 5173, 3000, 5432, 6379, 5672 and 15672. Host worker development also uses 3001.

On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`; changing execution policy is unnecessary. Commands below use `npm` for portability.

### Local service directory

These are the default host addresses; configured port overrides may change them.

| Service             | Address or port                    | Purpose                                                    |
| :------------------ | :--------------------------------- | :--------------------------------------------------------- |
| Dashboard           | <http://localhost:5173>            | Browser entry point                                        |
| API                 | <http://localhost:3000/health>     | Direct API liveness                                        |
| API through web     | <http://localhost:5173/api/health> | Web-to-API proxy liveness                                  |
| Worker on host      | <http://localhost:3001/health>     | Worker liveness during host development; private in Docker |
| PostgreSQL          | `localhost:5432`                   | Relational database                                        |
| Redis               | `localhost:6379`                   | Cache, presence, and live event transport                  |
| RabbitMQ            | `localhost:5672`                   | AMQP connections                                           |
| RabbitMQ management | <http://localhost:15672>           | Local broker interface using configured credentials        |

## Local development

### 1. Install dependencies

```sh
npm ci
```

### 2. Configure the environment

Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell, `cp .env.example .env` on macOS/Linux). Set local database and broker passwords, two distinct demo emails, and demo passwords of 12 to 128 characters. Generate `JWT_SECRET` using the command in `.env.example` (at least 32 random characters). Replace all placeholder values. `.env` is ignored by Git and excluded from Docker builds. Never put credentials in `VITE_*` variables: Vite exposes those to browser code.

### 3. Start infrastructure and prepare the database

Start infrastructure:

```sh
docker compose up -d --wait postgres redis rabbitmq
npm run db:generate --workspace @aerqyn/api
npm run db:migrate --workspace @aerqyn/api
npm run db:seed --workspace @aerqyn/api
```

### 4. Start the applications

Run these in three separate terminals:

```sh
npm run dev:api
npm run dev:worker
npm run dev:web
```

Open <http://localhost:5173>. The mission-control dashboard provides login, mission management, live telemetry, anomaly controls and recorded-run replay. API liveness is available at <http://localhost:3000/health>; worker liveness is at <http://localhost:3001/health> when running on the host. The web proxy makes <http://localhost:5173/api/health> reach the API without requiring CORS.

### Environment and connection behavior

Backend scripts load the root `.env`; Vite loads it using `envDir`. If changing `API_PORT`, also change `API_PROXY_TARGET` to match. Environment variables already set in the terminal take precedence. Set `DATABASE_URL` to match your database username, password, host port and database name; URL-encode credentials. Set `REDIS_URL` for both backend services (default `redis://127.0.0.1:6379`); change it too if changing `REDIS_PORT`. The worker requires `RABBITMQ_URL` with your broker username, URL-encoded password and host port, for example `amqp://aerqyn:your_password@127.0.0.1:5672`. Compose supplies internal database, Redis and broker URLs. The API validates its database URL, Redis URL and `JWT_SECRET` at startup. API development, type checking and builds automatically generate the Prisma client.

## Full Docker setup

### Build, start, and seed

After creating `.env`:

```sh
docker compose config --quiet
docker compose up --build -d --wait --wait-timeout 180
docker compose exec api node apps/api/dist/seed-cli.js
docker compose ps
docker compose logs api worker web
```

Open <http://localhost:5173> and <http://localhost:5173/api/health>. RabbitMQ's local management UI is at <http://localhost:15672>, using the credentials from `.env`.

### Health checks

All six containers have health checks. PostgreSQL, Redis and RabbitMQ must become healthy before the app containers start. App health endpoints report **process liveness only**, not infrastructure connectivity. The worker port is private in Docker; inspect it with:

```sh
docker compose exec worker node -e "fetch('http://127.0.0.1:3001/health').then(r => r.text()).then(console.log)"
```

### Networks and service routing

The `frontend` network connects web and API. The separate `backend` bridge network connects API, worker and infrastructure; web does not join it. It permits outbound access and localhost port publishing for host development. Docker's `internal: true` network mode prevented the infrastructure host ports from being published during verification, so it is not used here. Database and broker host ports are bound to localhost. No service is intended for public deployment. Redis has no password in this local setup.

RabbitMQ health probes run as the `rabbitmq` user through `gosu`. Running an early probe as root can create a root-owned Erlang cookie and prevent the broker from starting.

Compose keeps internal app ports fixed and maps configurable host ports from `.env`. Container service names resolve within their networks, so the container web proxy uses `http://api:3000`, while host development uses `http://127.0.0.1:3000`. The browser always uses the web origin. Mission requests flow through web `/api/missions` → Express → Zod validation → Prisma → PostgreSQL → JSON response. Compose supplies the API's internal database URL and runs committed migrations before starting it.

### Persistence and credentials

Named volumes retain database, Redis AOF, broker data and JSONL event logs across container recreation. RabbitMQ has a stable hostname so its node identity remains stable. Changing credentials in `.env` does not automatically change accounts stored in existing volumes. `docker compose down` stops the stack and retains data. Avoid `down -v` unless deliberately discarding all local data.

### Rebuilds and runtime behavior

Images build TypeScript and Vite assets once; run `docker compose up --build -d --wait` after source changes. Use host development for hot reload. App processes run as the non-root Node user; the web image gives that user ownership of Vite's temporary configuration cache so preview can start. The image deliberately retains development dependencies for this foundation; Vite preview serves the demo build and is not a production hosting solution.

## Authentication and RBAC (M2)

### Login contract

`POST /auth/login` accepts only `{ "email": "researcher@aerqyn.local", "password": "your local demo password" }`. Emails are normalized to lowercase. Use your configured `DEMO_*` email/password values from the ignored `.env`; there are no committed default passwords. Missing accounts and wrong passwords return the same 401 `INVALID_CREDENTIALS` response. Invalid input returns 400.

A successful response has `{ "data": { "accessToken": "...", "tokenType": "Bearer", "expiresIn": 900, "user": { "id": "...", "email": "...", "role": "RESEARCHER" } } }` and `Cache-Control: no-store`. Passwords and hashes are never returned. Login is limited to 20 attempts per IP per 15 minutes; exceeding that returns 429 `RATE_LIMITED`.

### Authenticate from PowerShell

PowerShell example (enter the Researcher password you set in `.env`):

```powershell
$credentials = Get-Credential -UserName 'researcher@aerqyn.local' -Message 'AERQYN demo login'
$loginBody = @{ email = $credentials.UserName; password = $credentials.GetNetworkCredential().Password } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3000/auth/login -ContentType application/json -Body $loginBody
$headers = @{ Authorization = "Bearer $($login.data.accessToken)" }
Invoke-RestMethod -Uri http://localhost:3000/missions -Headers $headers
```

Through the web proxy use `/api/auth/login` and `/api/missions` on port 5173 instead.

### Permissions

| Endpoint                                                        | Public | Observer | Researcher |
| --------------------------------------------------------------- | ------ | -------- | ---------- |
| `GET /health`, `POST /auth/login`                               | Yes    | Yes      | Yes        |
| `GET /missions`, `GET /missions/:id`                            | 401    | Allowed  | Allowed    |
| `POST /missions`, `PATCH /missions/:id`, `DELETE /missions/:id` | 401    | 403      | Allowed    |

### Token verification and request flow

The login flow is JSON -> Zod -> user lookup -> salted scrypt password check -> signed JWT. Protected requests flow through Bearer token verification -> current user/role lookup in PostgreSQL -> role middleware -> existing mission validation and database operations. Authentication establishes identity (401 on failure); authorization checks that identity's permissions (403 on failure).

[jose JWT verification](https://github.com/panva/jose/blob/main/docs/jwt/verify/interfaces/JWTVerifyOptions.md) checks the signature with the pinned HS256 algorithm, issuer `aerqyn-api`, audience `aerqyn`, and required subject/issued-at/expiry claims. Tokens expire after 15 minutes. Roles come from the database on every request, so changing a role or deleting a user affects existing tokens immediately. Signing out discards the in-memory token; server-side token revocation and refresh tokens are not implemented. Password reseeding does not invalidate existing tokens; rotating `JWT_SECRET` invalidates all of them.

### Demo account seeding

`db:seed` explicitly upserts the two configured demo accounts, updating passwords and roles while preserving account IDs. Running it again is safe for missions and does not create duplicate emails. Changing a demo email creates a new account and leaves the previous email's account intact. Docker applies migrations at startup but does **not** automatically reseed credentials; use the explicit seed command above after first startup or when intentionally updating demo credentials.

### Authentication limitations

Limitations: local demo only; no registration, password-reset, user-management, refresh-token features. The login limiter uses process-local memory and resets on restart. The local web proxy shares its API-facing IP across browser clients, so those logins share a limit. A future public deployment would need a deliberate proxy and distributed rate-limit configuration. Health remains public process liveness only. The M5 frontend supports seeded-account login.

## Mission API (M1)

Use `http://localhost:3000/missions` directly or `http://localhost:5173/api/missions` through the web proxy.

| Method | Path                          | Result                                     |
| ------ | ----------------------------- | ------------------------------------------ |
| POST   | `/missions`                   | Create a draft; 201 with `Location` header |
| GET    | `/missions?limit=20&offset=0` | List newest first; 200                     |
| GET    | `/missions/:id`               | Fetch one mission; 200                     |
| PATCH  | `/missions/:id`               | Update provided fields; 200                |
| DELETE | `/missions/:id`               | Delete a mission; 204 with no body         |

### Create and fetch a mission

Create example in PowerShell (use `$headers` from the login example above):

```powershell
$body = @{ name = 'Local flight'; description = 'Synthetic route' } | ConvertTo-Json
$mission = Invoke-RestMethod -Method Post -Uri http://localhost:3000/missions -Headers $headers -ContentType application/json -Body $body
Invoke-RestMethod -Uri "http://localhost:3000/missions/$($mission.data.id)" -Headers $headers
```

### Validation and update behavior

Requests use JSON. `name` is trimmed and must contain 1–100 characters; `description` is trimmed, defaults to an empty string, and allows up to 2000 characters. Optional `settings` contains `durationSeconds` (integer 10–3600, default 300) and `telemetryIntervalMs` (integer 100–5000, default 1000). M3 uses these settings to run a fleet of exactly three drones.

IDs are UUIDs, timestamps are UTC, and status is assigned `DRAFT` by the server. Neither create nor update accepts status, IDs or timestamps. PATCH requires at least one editable field. Omitted fields stay unchanged; supplying `settings` replaces that object and applies defaults to omitted settings keys. Unknown request fields are rejected. Lists accept `limit` 1–100 and `offset` 0–100000, and use ID as a tie breaker when creation times match.

### Response and error conventions

Success responses use `{ "data": ... }`; lists also return `pagination` with `limit` and `offset`. Errors use `{ "error": { "code": "...", "message": "..." } }`: invalid input/UUIDs return 400, missing missions or routes return 404, bodies over 16 KB return 413, and unexpected failures return 500 without internal details. Offset pagination can shift when missions are added or deleted between requests.

### Schema and migrations

The schema is in `apps/api/prisma/schema.prisma`; committed SQL migrations describe database changes, while the ignored generated client provides typed queries. For an intentional future schema change use `npm run db:dev --workspace @aerqyn/api -- --name descriptive_change`; review and commit the generated SQL. Use `db:migrate` to apply committed migrations without generating new ones.

The live flow is worker → Redis cache/pub/sub → API → Socket.IO clients. M4 adds durable RabbitMQ analysis jobs and PostgreSQL alerts. M5 adds stored telemetry replay; M6 adds persistent JSONL event logging.

## Drone simulation and live subscriptions (M3)

| Method | Path                      | Permission and result                                |
| ------ | ------------------------- | ---------------------------------------------------- |
| POST   | `/missions/:id/start`     | Researcher; start or restart from the beginning; 200 |
| POST   | `/missions/:id/stop`      | Researcher; stop a running mission; 200              |
| GET    | `/missions/:id/telemetry` | Either role; latest cached frame or `null`           |
| GET    | `/missions/:id/viewers`   | Either role; `{ data: { count: 2 } }`                |

Commands accept an absent body or `{}` only. Starting an already running mission or stopping a non-running mission returns 409 `INVALID_STATE`. Missing missions return 404. Editing/deleting a running mission returns 409; stop it first. Starting assigns a new persisted `startedAt` value; stopped/completed missions can restart. Duration and telemetry interval use the existing mission settings. Reads return 503 `UNAVAILABLE` if Redis is not ready.

### Simulation engine

The worker polls PostgreSQL every 100 ms without overlapping ticks. It locks each running mission row while generating and caching/publishing a frame, preventing concurrent lifecycle changes during that tick. Frame timestamps are quantized to the configured telemetry interval; identical frames are not republished. Three drones follow offset square routes in a synthetic 100-by-100 field at five field units per second. Battery decreases by 0.02 percentage points per second. Normal samples report `CONNECTED`; M4 injection samples may report `DISCONNECTED`. At the duration boundary, the final frame has zero speed and `COMPLETED` status, and PostgreSQL records completion. Broker connection/confirmation failures can delay a worker cycle by several seconds.

### Recovery and cached state

Movement depends on the persisted start time, so restarting a worker resumes elapsed mission time. Missed frames are skipped; an outage longer than the remaining duration leads to completion when infrastructure returns. PostgreSQL is the source of mission status; Redis caches frames under `aerqyn:mission:<id>:state` for two hours and publishes them on `aerqyn:telemetry`. The API validates incoming frames and checks their mission/run identity before delivery. Reads return `null` before the first frame, after stop, or while only an earlier run is cached. Completed frames remain readable until expiration. This cache is not telemetry history.

### Subscribe to live telemetry

Use a Socket.IO v4 client with `auth: { token: accessToken }`. Connect to `http://localhost:5173` through the web proxy (default `/socket.io` path), or directly to port 3000 from a Node client. The proxy supports polling and WebSocket upgrades. The M5 dashboard uses this authenticated connection.

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:5173', { auth: { token: accessToken } });
socket.on('telemetry', (frame) => console.log(frame));
socket.on('mission:viewers', ({ missionId, count }) =>
  console.log(missionId, count),
);
socket.on('connect', async () => {
  // Rejoin after reconnect. Login again and update socket.auth when the JWT expires.
  const result = await socket
    .timeout(5000)
    .emitWithAck('mission:join', { missionId });
  console.log(result); // { data: { missionId, telemetry } } or { error: { code, message } }
});
// await socket.timeout(5000).emitWithAck('mission:leave');
```

### Subscription lifecycle and presence

Each socket subscribes to one mission at a time. Joining another leaves the previous room; both roles may view any mission. A frame includes `missionId`, `startedAt`, `timestamp`, `elapsedMs`, `status`, and three `drones` with `id`, `x`, `y`, `speed`, `battery` and `connectionStatus`. Handshakes and joins verify JWTs/current users; each telemetry delivery rechecks authorization. Idle sockets are revalidated every 15 seconds and disconnected if authentication fails. Tokens expiring during a run cannot continue receiving telemetry.

Viewer counts represent subscribed connections, so two tabs count as two viewers. Redis sorted sets store socket IDs with 45-second leases, refreshed every 15 seconds. Leave/disconnect removes entries; reads and presence updates prune expired leases, and the key expires after 60 seconds without refresh. A process crash can leave a viewer counted until its lease expires. Graceful cleanup is asynchronous. All synthetic telemetry remains local; no real-drone interface exists.

### Live-stack verification

To verify the running Docker stack (seed demo users first), run `npm run smoke:simulation`. It uses `.env` credentials without logging them, opens WebSocket and polling clients through the web proxy, verifies isolation, permissions, movement, cache, all three anomaly types, persistent/live alerts, stop/restart/completion and presence, then deletes its temporary missions and their alerts/jobs. It needs all six running services. `SIMULATION_ORIGIN` can override the web URL. Completed smoke cache entries expire naturally.

### Delivery guarantees and limitations

Backend concepts: a **room** routes events only to subscribers of a mission; **pub/sub** carries live worker events between processes. Redis pub/sub is transient and can lose frames during disconnects; joining returns the latest cache and future frames resume after reconnect. PostgreSQL transactions serialize mission lifecycle changes, but PostgreSQL and Redis do not share an atomic transaction. This local MVP does not guarantee exactly-once delivery, replay of missed live events, immediate lifecycle notifications, or production scaling. Run one API and one worker; coordinated multi-instance deployment and backpressure need further work.

## Synthetic anomalies and alerts (M4)

### Submit an anomaly

Researcher commands use `POST /missions/:id/anomalies` with exactly:

```json
{ "droneId": "drone-1", "type": "GPS_JUMP" }
```

Valid drone IDs are `drone-1`, `drone-2`, and `drone-3`. Types are `GPS_JUMP`, `BATTERY_DROP`, and `COMMUNICATION_LOSS`. The mission must be running and within its configured duration. Unknown fields/types/IDs return 400; missing missions return 404; inactive/elapsed missions return 409; 100 pending jobs for a mission returns 429 `QUEUE_FULL`. Unauthenticated requests return 401 and Observer writes return 403. The accepted response is HTTP 202 with `{ "data": { "id": "job UUID", "missionId": "mission UUID", "status": "PENDING" } }`. Acceptance means the database saved the job; analysis is asynchronous. Retrying an HTTP request creates another intentional injection.

### Synthetic sample generation

The API locks the mission, generates a deterministic baseline and one modified synthetic sample, and saves both in `AnomalyJob`. GPS injection adds 100 field units to X; battery injection subtracts 40 percentage points (clamped at zero); communication injection sets `DISCONNECTED` and zero speed. Other drones stay unchanged. These are single samples, not lasting changes to the flight engine. Telemetry permits bounded out-of-field positions (-1000 to 1000) for synthetic GPS anomalies.

### Queue processing and detection rules

About once a second, the worker relays pending database jobs to the durable `aerqyn.anomaly-analysis` RabbitMQ queue using persistent messages and publisher confirmations. Queue messages contain only the job UUID; the worker reads and validates the saved measurements. The consumer uses prefetch 1 and manual acknowledgements. It locks the mission and job, compares measurements, and commits alerts together with the processing outcome:

| Rule               | Detection condition                                                                |
| ------------------ | ---------------------------------------------------------------------------------- |
| GPS jump           | Euclidean displacement exceeds `20 + previous speed × elapsed seconds` field units |
| Battery drop       | More than 20 percentage points lost between samples                                |
| Communication loss | Connection changes from `CONNECTED` to `DISCONNECTED`                              |

The detector does not infer an alert from the command label. Duplicate jobs are harmless after processing; row locks and a unique `(jobId, droneId, type)` constraint prevent duplicate alerts. Stop/restart makes queued old-run jobs `STALE`; malformed stored payloads become `INVALID`. Invalid RabbitMQ envelopes are rejected to `aerqyn.anomaly-analysis.dead` for inspection. Transient database processing failures leave the job pending; the message is acknowledged and the database outbox republishes after five seconds, avoiding a tight requeue loop. Broker reconnection is retried after five seconds; confirmations time out after five seconds. No broker credential is sent to the browser.

### Live alerts and persisted history

After committing analysis, the worker publishes the modified sample on the existing `telemetry` stream and on Redis `aerqyn:anomaly-samples`, and alert events through Redis `aerqyn:alerts`. The API validates run identity and authentication before emitting Socket.IO `anomaly:sample` and `alert` events to that mission's subscribers. Each alert has `id`, `missionId`, `startedAt`, `droneId`, `type`, `message`, and `createdAt`. Register `socket.on('alert', handler)` before issuing commands. Anomaly samples keep their original measurement timestamp and can arrive after a newer normal frame; they do not replace the latest normal Redis cache. Normal ticks continue their deterministic route.

The dashboard previews the most recently processed anomaly sample in the field and telemetry cards for eight seconds, labeled **ANOMALY PREVIEW** and **Injected sample**. Live telemetry continues in the background and resumes automatically after the preview. This separate event prevents delayed samples from being hidden by live frame ordering. A new injection replaces the preview; stopped missions, other runs, and recorded replay do not show it. This is a preview of one altered measurement, not a lasting change to simulated flight physics. Alerts remain in the timeline. Missed preview events are transient; alert history is persisted.

With the optional browser tooling described in `docs/DEMO.md`, run `node --env-file-if-exists=.env scripts/verify-anomaly-ui.mjs` against the local stack to verify all three visible effects, preview duration and return to live at a 100 ms telemetry interval. It creates and deletes only its own test mission and saves screenshots under ignored `.cache/anomaly-verification/`.

Both roles can read `GET /missions/:id/alerts?limit=20&offset=0` (limit 1–100, offset 0–100000). It returns `{ "data": [alerts], "pagination": { "limit": 20, "offset": 0 } }`, newest first with ID tie-breaking, including earlier runs of that mission. Use `startedAt` to distinguish runs. Reconnect clients should fetch history because live Redis delivery is transient. Mission deletion cascades to its jobs and alerts.

### Inject and inspect from PowerShell

PowerShell example after login and starting a mission:

```powershell
$body = @{ droneId = 'drone-1'; type = 'GPS_JUMP' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/missions/$missionId/anomalies" -Headers $headers -ContentType application/json -Body $body
# Allow asynchronous processing, then fetch persisted alerts.
Invoke-RestMethod -Uri "http://localhost:3000/missions/$missionId/alerts" -Headers $headers
```

### Implementation map

Files: `apps/simulation/src/anomalies.ts` contains contracts/injection/detection; `apps/api/src/anomalies.ts` handles authorized commands/history; `apps/worker/src/anomalies.ts` handles queue delivery, transactions and notification; `apps/api/src/realtime.ts` delivers room events. The Prisma schema/migration persists jobs/alerts; integration and smoke tests exercise the complete flow.

### Outbox, retries, and limitations

Backend concepts: a **transactional outbox** saves work in the same database transaction as acceptance, so RabbitMQ can be unavailable without losing accepted requests. **Idempotent processing** lets retries reuse a job UUID without duplicating alerts. PostgreSQL, RabbitMQ and Redis do not share one transaction: notifications may repeat after a crash (deduplicate by alert ID), and live subscribers can miss them during disconnects. Unsent events for stopped/restarted missions are suppressed, while persisted alerts remain readable. Jobs/alerts have no automatic retention policy, and dead letters require manual inspection. M5 adds the dashboard and telemetry replay; M6 adds the persistent JSONL event journal described below.

## Mission-control dashboard and replay (M5)

Open **http://localhost:5173** with the Compose stack running. Log in using the
Researcher or Observer email/password configured in your ignored `.env` and
seeded in M2. Passwords are never embedded in the frontend. Tokens stay in React
memory, so refreshing the page requires signing in again; sessions expire after
15 minutes.

### Demo walkthrough

1. Sign in as Researcher, choose **Create mission**, and enter a name, description,
   duration (10-3600 seconds) and telemetry interval (100-5000 ms).
2. Select the mission and **Launch mission**. Three colored markers move around
   the synthetic field; the cards show coordinates, speed, battery and connection.
3. Open a separate browser session as Observer. Select the same mission to see
   telemetry and viewer presence. Observer controls are disabled; backend RBAC
   still rejects writes independently of the interface.
4. Select a drone and an anomaly, then **Inject anomaly**. Acceptance queues the
   job; the timeline updates when the worker persists and publishes its result.
5. Stop or finish the flight. Select **Recorded runs**, choose a run, and scrub or
   play its stored frames. Playback follows recorded timestamp gaps. **Live**
   returns to current telemetry. Click **Recorded runs** again to refresh a
   recording that is still in progress.
6. Edit or delete a stopped mission. Deletion requires confirmation and also
   removes its alerts, jobs and telemetry recordings.

### Replay API and data flow

Authenticated `GET /missions/:id/replay` returns
`{ data: { runs: string[], frames: Telemetry[] } }`. Both roles can read it. Runs
are ISO start timestamps, newest first (up to 100); frames default to the latest
recorded run. An optional `?startedAt=<ISO timestamp>` selects a particular run.
A nonexistent run returns an empty frame array; a missing mission returns 404.
Unknown query keys and invalid IDs/timestamps return 400.

The browser sends JWT-authenticated commands through Vite's `/api` proxy to
Express. The worker generates telemetry, stores selected normal frames in
PostgreSQL, and publishes live samples through Redis. The API delivers validated
samples to authenticated Socket.IO mission rooms. The browser validates incoming
payloads with shared Zod contracts, ignores older samples/runs, and deduplicates
alerts by ID when reconciling live events with history after reconnecting.

The `TelemetrySnapshot` table uses `(missionId, startedAt, elapsedMs)` as its
primary key. The worker records at most one normal sample per five-second bucket,
plus the completion frame, inside the existing mission-row transaction. This
makes duplicate ticks idempotent and keeps separate launches separate. Mission
row locks coordinate snapshot creation with stop/restart/delete operations.
Replay reads PostgreSQL independently of Redis. Existing M0-M4 runs have no
backfilled recordings.

### Main implementation files

- `apps/web/src/App.tsx`: login, mission directory/editor, field, cards, controls,
  timeline and replay UI; `styles.css`: responsive navy/cyan design and reduced
  motion support.
- `apps/web/src/api.ts`: validated HTTP boundaries and frame/alert reconciliation;
  `useMissionStream.ts`: authenticated subscriptions, reconnect and cleanup.
- `apps/simulation/src/contracts.ts`: browser-safe shared settings and telemetry
  schemas, separated from the Redis client entry point.
- `apps/worker/src/simulator.ts`: selected snapshot writes.
- `apps/api/src/simulation.ts`, `apps/api/prisma/schema.prisma`, and migration
  `202610170005_telemetry_snapshots`: authenticated replay reads and storage.
- API integration/endpoint tests, `apps/web/src/api.test.ts`, and
  `scripts/simulation-smoke.mjs`: regression and live-stack coverage.

Two useful concepts: **idempotency** prevents repeated work from producing
multiple copies of the same snapshot; **reconciliation** merges durable history
with transient live events so reconnects do not duplicate alerts.

### Verification and limits

Run `npm run check`, `npm run test:integration`, `npm run smoke`, and
`npm run smoke:simulation` (use `npm.cmd` in PowerShell). Integration tests use an
isolated database schema and verify recording deduplication, run separation,
Observer reads and replay after restart. Browser data tests cover out-of-order
frames, duplicate alerts, payload validation and authorization failures.

Recordings contain selected normal telemetry, not every tick or injected anomaly
sample; alerts remain separately available across all runs. Worker downtime can
leave recording gaps. Replay is a basic timestamp-paced sequence, not video or
interpolation. The alert panel shows the latest 100 alerts, and the run picker
shows the latest 100 recorded runs. Recordings have no automatic retention policy;
mission deletion cascades to them. Mission status refreshes every five seconds.
Role changes remain enforced immediately by the backend; UI role labels update
on the next login. Redis delivery remains transient. M6 verified the main workflow
in an actual Edge browser and captured desktop/mobile screenshots and a demo;
see [demo evidence and reproduction](docs/DEMO.md) for coverage and limits.

## Persistent event journal (M6)

The worker appends schema-validated simulation events to daily
`YYYY-MM-DD.jsonl` files on the named `aerqyn_event_logs` Docker volume at
`/var/log/aerqyn`. Files use UTC dates and private `0600` permissions inside Linux.
Host development uses `EVENT_LOG_DIR` (relative to the worker's current directory);
the example value `../../.cache/events` puts logs in the repository's ignored
cache when running `npm run dev:worker`. Without an override the default is
`.cache/events` relative to the process directory. Compose always supplies its
volume path. JSONL files and cache directories are excluded from Git and Docker
build context.

### Record format

Each line is a JSON object with `version: 1`, an ISO UTC `timestamp`, a `type`,
and event `data` where applicable:

| Type                 | Data and timing                                                         |
| -------------------- | ----------------------------------------------------------------------- |
| `worker.started`     | No data; written before worker startup proceeds                         |
| `telemetry.snapshot` | Normal telemetry newly committed for a five-second bucket or completion |
| `anomaly.sample`     | Synthetic altered telemetry before notifying an eligible active run     |
| `alert.detected`     | Persisted alert, including stable ID, before live alert publication     |

The record timestamp is journal time; payload timestamps retain measurement/run
time. JSON encoding escapes embedded newlines. Strict schemas reject extra
fields; no request bodies, JWTs, passwords or arbitrary exception objects are
passed to the journal. API access/error output remains separate console logging.

### Inspect and export logs

Inspect or copy local journal files:

```sh
docker compose exec worker node --input-type=module -e "import { readdir } from 'node:fs/promises'; console.log(await readdir(process.env.EVENT_LOG_DIR))"
docker compose cp worker:/var/log/aerqyn .cache/event-log-export
```

Create `.cache` first if it does not yet exist (`mkdir .cache`). The export is
local and ignored. Mission deletion leaves journal records intact. There is no
automatic retention policy; monitor disk usage and archive old closed daily files
when needed. The application only appends; administrators can still modify files.

### Implementation and persistence verification

The implementation lives in `apps/worker/src/journal.ts` and its tests, with
call sites in `simulator.ts`, `anomalies.ts` and `index.ts`. `Dockerfile` creates a
directory owned by the non-root worker; `compose.yaml` mounts the named volume.
Integration tests verify snapshot deduplication and notification recovery after
a journal failure. The journal verifier checks real container records and
permissions, replaces only the worker container, then checks that all original
bytes remain and startup appends another event:

```sh
npm run check
npm run test:integration
npm run smoke
npm run smoke:simulation
node scripts/verify-journal.mjs
```

Build first and run the live smoke check before the journal verifier so all
event types exist. The last command briefly restarts the worker and should run
between demonstrations. It retains the log volume and existing mission data.
See [docs/DEMO.md](docs/DEMO.md) for optional browser-capture dependencies and
commands; app setup does not require Playwright.

### Recorded M6 verification

Verified on 2026-10-17: lint, formatting, strict type checks, **95 default tests**
(five infrastructure tests explicitly skipped), all four builds, **five real
infrastructure integration tests**, compiled and live simulation smoke checks,
full Compose build/start with six healthy services, journal persistence across
container replacement, and the recorded browser walkthrough. Production
dependency audit reported zero known vulnerabilities. The [security review](docs/SECURITY.md)
details the reviewed boundaries and local-only assumptions.

### Journal guarantees and limitations

Two useful concepts are **append-only event records**, which preserve earlier
lines instead of overwriting state, and **transaction boundaries**: a database
commit and a filesystem append cannot be one atomic operation here. Snapshot
logs can have gaps after a crash/write failure even though PostgreSQL replay is
intact. Anomaly journal failure delays notification and leaves results eligible
for retry; retries may repeat records, and stopping/restarting can suppress
unnotified old-run events. This journal is not an exactly-once audit trail or the
replay source. There is no per-write `fsync`, tamper protection, multi-worker
logging coordination, or automatic backup/retention. Health remains liveness only.

## Verification

```sh
npm run check
npm run test:integration
npm run smoke
npm run smoke:simulation
node scripts/verify-journal.mjs
```

### Local checks and compiled smoke tests

`check` runs ESLint, formatting, strict TypeScript checks, Vitest/Supertest tests and all four workspace builds. `smoke` requires those builds, starts all three application processes on temporary ports, checks API and worker health, checks web HTML and the web-to-API proxy, verifies unauthenticated missions return 401 directly and through the proxy, rejects invalid backend port settings, then stops its child processes. It does not verify Docker or infrastructure.

### Infrastructure integration tests

`test:integration` requires PostgreSQL, Redis, RabbitMQ and the root `.env` database/Redis/broker URLs. It creates a randomly named `m2_test_*` schema, applies the real migrations, and verifies authentication, CRUD, roles, lifecycle races, actual worker ticks, Redis caching, Socket.IO room isolation and viewer cleanup. M4 also verifies the real RabbitMQ pipeline, anomaly samples, persistent alerts, duplicate delivery, broker unavailability, worker restart before notification, stale runs and dead-letter handling. It drops that schema, its mission-specific Redis keys and its random `aerqyn.test.*` queues afterward; it never deletes development missions. The database user needs schema creation permission. The standard test run skips this integration suite explicitly. An interrupted run may leave test data behind.

### Formatting and test compilation

Use `npm run format` to apply formatting. Backend and shared-package tests are checked separately from production emit through the test TypeScript config. Do not commit dependencies, `.env`, build output or coverage.

### Interpreting health checks

Container readiness and application liveness are different checks: `/health` reports a running process even if infrastructure is unavailable. Database request failures return a generic JSON 500. The M5 dashboard provides login and mission controls. All mission endpoints require JWT authentication; mutations additionally require the Researcher role.

## Documentation guide

| Document                              | What to find there                                                                       |
| :------------------------------------ | :--------------------------------------------------------------------------------------- |
| [Project specification](PROJECT.md)   | Product scope, technology choices, core functionality, non-goals, and definition of done |
| [Milestone tracker](TASKS.md)         | M0-M6 completion records, dated verification evidence, and implementation history        |
| [Architecture](docs/ARCHITECTURE.md)  | Service topology, telemetry flow, anomaly sequence, and storage/failure boundaries       |
| [Security review](docs/SECURITY.md)   | Authentication, authorization, validation, and local-demo limitations                    |
| [Demo guide](docs/DEMO.md)            | Screenshots, recorded walkthrough, and browser-capture reproduction                      |
| [Development instructions](AGENTS.md) | Code quality, security, verification, and Git workflow rules                             |

AERQYN targets one local API and one worker. Detailed feature-specific limitations
are documented alongside each implementation above; public deployment and
physical drone integration are outside the project scope.
