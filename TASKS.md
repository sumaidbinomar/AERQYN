# AERQYN — Development Milestones

## M0 — Repository Foundation

- [x] Initialize Git repository
- [x] Create project documentation
- [x] Set up monorepo structure
- [x] Configure TypeScript, ESLint and formatting
- [x] Create Docker Compose infrastructure
- [x] Verify development environment

Verification on 2026-10-17:

- Existing Git repository confirmed; no commits created.
- Node.js 24.11.0 and npm 11.6.1 available. Use `npm.cmd` under this PowerShell execution policy.
- Dependency installation succeeded; npm reported zero known vulnerabilities.
- `npm run check` passed: ESLint, Prettier, strict TypeScript checks (including API tests), two Vitest/Supertest endpoint tests, and all three workspace builds.
- `npm run smoke` passed: compiled API/worker health, worker 404, web preview HTML, web-to-API proxy, and invalid backend port rejection. Child processes were stopped afterward.
- Docker Engine 29.8.2 and Compose v5.6.0 verified after Docker installation. Created an ignored local `.env` with generated database and broker passwords; values were not logged.
- `docker compose config --quiet` and `docker compose up --build -d --wait --wait-timeout 180` passed after resolving startup issues. All six services are healthy; all three application builds passed inside Linux containers.
- Fixed RabbitMQ's early root health probe creating an unreadable Erlang cookie by running probes as the broker user. Removed backend `internal: true` because it prevented localhost infrastructure port publishing; web remains on a separate network, and host bindings remain localhost-only. Gave the non-root web process ownership of Vite's temporary configuration cache.
- Verified API `/health` directly and through web `/api/health`, frontend HTML and its built JavaScript asset, worker `/health` inside its container, PostgreSQL `SELECT 1`, Redis `PING`, RabbitMQ `check_running`, its management HTTP page, and host TCP access on ports 5432, 6379 and 5672.
- Re-ran `npm run check` successfully after Docker installation; formatting also passed after the Compose and README changes. The earlier host smoke check passed; the container checks above verify the deployed M0 processes.
- M0 is complete and ready for review. The local stack is left running. Application health remains liveness-only; database/broker clients and all later milestone features remain unimplemented. No commits or pushes were made, and no later milestone work has started.

## M1 — REST API and Database

- [x] Configure Express and Prisma
- [x] Create PostgreSQL schema
- [x] Implement mission CRUD
- [x] Add Zod validation
- [x] Add consistent error handling
- [x] Write CRUD endpoint tests

Verification on 2026-10-17:

- Added Prisma 7 with the PostgreSQL driver adapter, a committed mission migration, generated-client scripts, validated database configuration, and graceful client shutdown. The ignored local `.env` now contains a matching host database URL; credentials were not printed or committed.
- Implemented POST/GET/PATCH/DELETE `/missions`, bounded offset pagination, UUID checks, strict Zod request schemas, server-assigned draft status, and consistent JSON errors including malformed/oversized bodies and missing missions.
- `npm run check` passed: lint, formatting, strict application/test TypeScript checks, 31 tests, and all three builds. The one PostgreSQL integration test is explicitly skipped in the default suite.
- `npm run test:integration` passed against real PostgreSQL: migrations applied in a random isolated schema; CRUD, defaults, pagination, persistence through a second connection, and missing-record behavior verified; test schema removed afterward.
- Applied the committed migration to the development database. Prisma migration diff reported no difference between PostgreSQL and the schema.
- `npm run smoke` passed for the compiled API, worker, frontend preview, proxy, and invalid-port rejection. The API development generation hook and final formatting check passed.
- Docker Desktop initially had a stalled Linux engine; restarting only its WSL distribution and Docker Desktop restored access without removing volumes.
- README documents host/Docker setup, API contracts, settings replacement on PATCH, testing, and limitations. Authentication/RBAC remain M2; simulation remains M3; `/health` remains process liveness only.
- `docker compose config --quiet` and the full Compose build/start passed; all six services became healthy. The container API applied migration deployment successfully. Live CRUD and validation passed through the web proxy and direct API; the verification mission was deleted afterward.
- The final API image rebuild/start passed after the development and shutdown adjustments. Confirmed Node runs directly under Docker's init process, all six containers are healthy, and final API liveness and database-backed requests work through the web proxy.
- M1 is complete. Changes are saved in small local Conventional Commits as authorized, ending with `docs: record M1 completion and mission API workflow`. No pushes or M2 work have been performed. The local Docker stack is left running; wait for approval before starting M2.

## M2 — Authentication and RBAC

- [ ] Implement JWT login
- [ ] Seed Researcher and Observer accounts
- [ ] Add authorization middleware
- [ ] Test protected endpoints

## M3 — Drone Simulation and WebSockets

- [ ] Implement three-drone simulator
- [ ] Create mission-specific Socket.IO rooms
- [ ] Stream live telemetry
- [ ] Cache current drone state in Redis
- [ ] Track active viewers

## M4 — RabbitMQ and Anomaly Detection

- [ ] Set up RabbitMQ producer and consumer
- [ ] Implement GPS, battery and communication anomaly injection
- [ ] Add rule-based anomaly detection
- [ ] Persist alerts
- [ ] Broadcast alerts in real time

## M5 — Frontend

- [ ] Build login screen
- [ ] Build animated 2D simulation field
- [ ] Build telemetry cards
- [ ] Add mission and anomaly controls
- [ ] Add live alert timeline
- [ ] Add basic telemetry replay

## M6 — Final Verification

- [ ] Add persistent timestamped JSONL logs
- [ ] Verify Docker Compose startup
- [ ] Run automated tests
- [ ] Review security and error handling
- [ ] Add screenshots and architecture diagram
- [ ] Finish README
- [ ] Record project demo
