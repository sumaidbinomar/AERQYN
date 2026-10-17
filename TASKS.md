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

- [x] Implement JWT login
- [x] Seed Researcher and Observer accounts
- [x] Add authorization middleware
- [x] Test protected endpoints

Verification on 2026-10-17:

- Added a User model and SQL migration with Researcher/Observer roles, unique normalized email addresses, and salted scrypt password hashes. Demo seeding uses validated environment credentials and transactional upserts; rerunning preserves account IDs.
- Added POST `/auth/login` with strict Zod validation, generic credential errors, 15-minute HS256 JWTs, no-store responses, and a process-local limit of 20 attempts per IP per 15 minutes. JWT verification pins the algorithm, issuer and audience and requires valid identity/time claims.
- Protected every mission route with authentication. Both roles can read; only Researchers can create, edit or delete. Each authenticated request reads the current database role; deleted users are rejected and role changes apply immediately. Health remains public.
- `npm run check` passed: lint, formatting, strict application/test TypeScript checks, 66 tests, and all three workspace builds. Three real-database tests are explicitly skipped by the default suite.
- `npm run test:integration` passed all three PostgreSQL tests in an isolated random schema: authenticated CRUD, persistence through another connection, salted password storage, idempotent seeding, Observer read/write permissions, and immediate role changes. The test schema was removed afterward.
- `npm run smoke` passed compiled API/worker/web liveness, proxy, direct/proxied unauthenticated mission rejection, and invalid-port configuration checks; child processes were stopped afterward.
- Applied the User migration to the development database and explicitly seeded both demo accounts. Generated missing M2 secrets only in ignored `.env`; no values were printed. The host seed command required an unsandboxed rerun because tsx's OS user-info lookup failed inside the sandbox; that rerun succeeded.
- `docker compose config --quiet` and full Compose build/start passed; all six containers are healthy. Explicit seeding inside the API container succeeded. Live direct/proxied checks passed for both demo logins, unauthenticated rejection, Researcher CRUD, Observer reads and denied writes. The verification mission was deleted afterward.
- README documents configuration, explicit seeding, login examples, role permissions, request flow and limitations. Tokens have no refresh/revocation API; password reseeding does not invalidate existing tokens. Login limits are process-local, and web-proxied browser clients share the proxy's IP limit. No registration, login UI, simulation or M3 work was added. M2 changes are saved in small local Conventional Commits as authorized. No pushes were made.
- M2 is complete. The local Docker stack is left running; wait for approval before starting M3.

## M3 — Drone Simulation and WebSockets

- [x] Implement three-drone simulator
- [x] Create mission-specific Socket.IO rooms
- [x] Stream live telemetry
- [x] Cache current drone state in Redis
- [x] Track active viewers

Verification on 2026-10-17:

- Added a shared strict TypeScript simulation workspace, Zod telemetry/settings contracts, and a migration persisting mission start times. Three synthetic drones follow deterministic offset square routes; telemetry honors the configured interval and duration, drains battery, and completes automatically. Worker restarts resume elapsed mission time without preserving in-memory state.
- Added authenticated POST `/missions/:id/start` and `/stop`, restricted to Researchers. Conditional database writes prevent duplicate starts; running missions cannot be edited/deleted. Either role can read cached telemetry and active viewer counts. Stopped/restarted runs cannot expose earlier cached frames.
- The worker polls PostgreSQL without overlapping ticks, uses row locks against concurrent lifecycle changes, caches the latest frame in Redis for two hours, and publishes telemetry through Redis pub/sub. The API validates frames and run identity before delivery. No RabbitMQ jobs, anomaly injection, dashboard, replay, snapshots or JSONL logging were added.
- Added authenticated Socket.IO mission subscriptions, cached-state acknowledgements, one mission per socket, presence events and Redis viewer leases. Tokens/current users are checked at connection/join and before telemetry delivery; idle sockets are revalidated every 15 seconds. Presence is removed on leave/disconnect; expired leases cover process crashes. Viewer counts represent connections, not unique accounts.
- `npm run check` passed: lint, formatting, strict application/test TypeScript checks, 74 tests, and all four workspace builds. Four integration tests are explicitly skipped by the default suite.
- `npm run test:integration` passed all four tests against real PostgreSQL and Redis in an isolated random schema. Verified concurrent starts, lifecycle conflicts, worker-generated frames, interval deduplication, cache reads, two viewers receiving one mission, another room receiving nothing, switching rooms, disconnect/expired-presence cleanup, stale-run filtering, natural completion, and disconnecting a deleted user before another telemetry delivery. Test users, missions, Redis keys and schema were cleaned up.
- `npm run smoke` passed compiled API/worker/web liveness, API proxy, protected routes and invalid-port rejection. `npm run smoke:simulation` passed against the actual Docker worker/API through the web proxy with WebSocket and polling clients: RBAC, movement, room isolation, cache, stop/restart/completion and presence cleanup. Temporary smoke missions were deleted; their caches expire naturally.
- `docker compose config --quiet` and full Compose build/start passed; all six services became healthy and the API applied the run-timing migration. The final API rebuild/start passed with the socket-input validation guard; all six services remain healthy. Prisma migration status confirms all three migrations are applied and the database schema is up to date.
- README documents endpoints, event payloads, data flow, testing and recovery behavior. Redis pub/sub is transient; PostgreSQL and Redis do not share an atomic transaction. Presence can remain counted for up to 45 seconds after a crash. Health remains liveness only. This implementation targets one local API and worker, without delivery replay or production scaling guarantees.
- Implementation/test commits: `2eef10d` (engine/schema/workspace), `130e5f3` (API/worker/Redis/Socket.IO), and `6063977` (integration/live tests and socket validation). Completion documentation is saved in a separate local commit. No pushes or M4 work have been performed. M3 is complete; the Docker stack is left running. Wait for approval before starting M4.

## M4 — RabbitMQ and Anomaly Detection

- [x] Set up RabbitMQ producer and consumer
- [x] Implement GPS, battery and communication anomaly injection
- [x] Add rule-based anomaly detection
- [x] Persist alerts
- [x] Broadcast alerts in real time

Verification on 2026-10-17:

- Added Researcher-only POST `/missions/:id/anomalies` with strict Zod validation, running/duration checks and a limit of 100 pending jobs per mission. Both roles can read paginated GET `/missions/:id/alerts`. Mission row locks serialize command acceptance with lifecycle changes. HTTP 202 means a job was saved, independently of broker availability.
- Added an `AnomalyJob` database outbox and persisted `Alert` records with a committed SQL migration. The worker publishes persistent UUID-only jobs to a durable RabbitMQ queue with confirmations, consumes with prefetch 1 and manual acknowledgements, and dead-letters invalid envelopes. Pending database jobs retry after five seconds; broker reconnection/confirmation waits are bounded. Processing commits alerts and job outcomes atomically; duplicate deliveries cannot duplicate alerts.
- Synthetic single-sample injections change GPS X by 100 field units, reduce battery by 40 percentage points, or report disconnected communication. Detection compares baseline and observed measurements using displacement, battery-loss and connection-transition rules. Normal deterministic simulation continues unchanged on subsequent ticks. Old-run jobs become stale; malformed stored payloads terminate as invalid.
- The worker publishes committed alerts and modified samples through Redis. Socket.IO validates the mission run and current authentication before delivery to mission rooms. Durable notification state survives worker restarts; Redis delivery remains transient and may repeat after a crash. Anomaly samples retain their measurement timestamp, may arrive after newer normal frames, and do not overwrite the latest normal cache. Persisted alert history covers all mission runs; mission deletion cascades to jobs/alerts.
- `npm run check` passed: lint, formatting, strict application/test TypeScript checks, 85 tests, and all four workspace builds. Five integration tests are explicitly skipped in the default suite. After tightening the smoke test's invalid-port assertion, lint/typecheck/the 85 tests and compiled smoke passed again.
- `npm run test:integration` passed all five tests against real PostgreSQL, Redis and RabbitMQ in an isolated random schema and queue. M4 coverage includes all three anomaly samples, Researcher/Observer live delivery, room isolation, persisted/paginated history, duplicate/concurrent processing, broker-unavailable acceptance, worker restart before notification, malformed-envelope dead-lettering, invalid stored payloads, and stale-run rejection. The schema, queues, test missions/users and Redis keys were cleaned up.
- `docker compose config --quiet` and full Compose build/start passed; all six containers became healthy. Prisma reports all four migrations applied, and database/schema comparison reports no difference. Worker logs show normal startup without connection errors.
- `npm run smoke` passed compiled API/worker/web liveness, proxy, protected routes and invalid-port rejection. Expanded `npm run smoke:simulation` passed against the actual Docker API/worker through the web proxy with WebSocket and polling clients: RBAC, movement, cache, all three anomaly types, durable/live alerts, room isolation, stop/restart/completion and viewer cleanup. Temporary missions and their jobs/alerts were deleted; cached normal frames expire naturally.
- README documents setup, API/event contracts, files, data flow, rule thresholds, outbox/idempotency concepts, testing and limitations. Notifications can be missed or repeated; clients should deduplicate alert IDs and fetch history after reconnect. Stopped/restarted missions suppress unsent live events. Jobs/alerts have no automatic retention policy; dead letters need manual inspection. Health remains liveness only, and the stack targets one local API/worker. No dashboard, replay or JSONL logging was added.
- Local implementation commits: `d92cb48` (rules/schema), `3a88066` (API, queue pipeline and integration/live tests), and `9eb7d9c` (smoke-test verification). Completion documentation is saved in its own local commit. No pushes were made. M4 is complete; the Docker stack is left running. Wait for approval before starting M5.

## M5 — Frontend

- [x] Build login screen
- [x] Build animated 2D simulation field
- [x] Build telemetry cards
- [x] Add mission and anomaly controls
- [x] Add live alert timeline
- [x] Add basic telemetry replay

Verification on 2026-10-17:

- Built the requested dark navy/cyan mission-control layout: seeded-account login, mission directory and editor, animated synthetic 2D field, three telemetry cards, Researcher controls, Observer view, and live alert timeline. The responsive interface includes keyboard focus styles, a modal editor, reduced-motion support, explicit deletion confirmation and visible request/connection errors.
- Added recorded-run selection, timestamp-paced playback, scrubbing and return-to-live controls. The worker persists one normal sample per five-second bucket plus completion in PostgreSQL. The authenticated replay endpoint supports both roles, validates query inputs and separates launches by start timestamp. Mission deletion cascades to recordings. No JSONL logging or other M6 work was implemented.
- Extracted browser-safe shared Zod contracts without pulling Redis into the frontend bundle. Tokens remain in memory, refresh requires login, and expiry/401 responses return the user to login. Socket cleanup handles mission changes/logout; reconnection reconciles alert history, deduplicates IDs and rejects out-of-order telemetry. Backend JWT/RBAC remain authoritative.
- `npm run check` passed: lint, formatting, strict application/test TypeScript checks, 90 tests and all four workspace builds. Five real-infrastructure tests are explicitly skipped by the default suite. The final frontend text/retry adjustments passed lint and the strict production build.
- `npm run test:integration` passed all five PostgreSQL/Redis/RabbitMQ tests. Added replay assertions verify repeated-tick deduplication, Observer reads, separate restarted runs, persisted completion and empty unknown-run results. Endpoint tests cover authentication and invalid selectors; browser data tests cover frame ordering, alert deduplication, response validation and authorization failures.
- `npm run smoke` passed compiled services, web preview, API proxy, protected routes and invalid-port rejection. Expanded `npm run smoke:simulation` passed against the Docker stack through the web proxy, including both roles, WebSocket/polling delivery, anomalies, alert persistence, two recorded runs, completion, frontend HTML and viewer cleanup. Temporary smoke missions and recordings were removed afterward.
- Full Compose build/start passed and all six services became healthy. The API applied the fifth migration. Prisma database/schema comparison passed after explicitly matching the snapshot foreign key's ON UPDATE NO ACTION setting. Mission IDs are immutable in the API.
- Final web-image rebuild/start passed; all six services remain healthy. Verified the served HTML, corrected JavaScript asset and API proxy. Lint, strict type checks and all 90 default tests passed again after the schema alignment.
- Corrected Windows text encoding in interface symbols during review. Browser automation and visual inspection were unavailable in this session; manual UI/keyboard/mobile review remains a verification limitation, with a walkthrough documented in README. Automated checks do not establish visual correctness.
- Replay contains selected normal frames, not every tick or injected anomaly sample; worker outages leave gaps. Alerts remain a separate history. The interface shows up to 100 alerts/recorded runs; recordings have no automatic retention policy. Mission status refreshes every five seconds; refreshed browser pages require login. Existing pre-M5 flights have no recordings.
- Local commits include `3a2d91a` (snapshot storage, shared contracts and replay API/tests) `e02752b` (mission-control frontend and browser data tests), and `a44277f` (deployed replay verification and schema alignment). Completion documentation is saved in a separate local commit. No pushes were made. M5 implementation is complete; wait for approval before starting M6.

## M6 — Final Verification

- [ ] Add persistent timestamped JSONL logs
- [ ] Verify Docker Compose startup
- [ ] Run automated tests
- [ ] Review security and error handling
- [ ] Add screenshots and architecture diagram
- [ ] Finish README
- [ ] Record project demo
