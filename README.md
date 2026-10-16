# AERQYN

A backend-focused UAV digital twin and cybersecurity simulation project. All future simulation data is synthetic and local; this project never controls physical drones.

Only **M0 — Repository Foundation** is implemented. [PROJECT.md](PROJECT.md) defines the product, [TASKS.md](TASKS.md) tracks milestones, and [AGENTS.md](AGENTS.md) defines development rules.

## Repository

```text
apps/
  web/       React + Vite + Tailwind placeholder
  api/       Express process with GET /health
  worker/    Node process with GET /health; no jobs yet
scripts/     Smoke verification for built processes
compose.yaml PostgreSQL, Redis, RabbitMQ and three app services
Dockerfile   Shared build with separate api, worker and web targets
```

npm workspaces share one dependency lockfile. Root scripts run each workspace's TypeScript check and build. The shared TypeScript config enables strict checking; backend code uses Node ESM and the web uses Vite's bundler resolution. There is no shared package until there is actual shared application code.

## Prerequisites

- Node.js 24 LTS (24.11.0 or newer within major 24) and npm 11.
- Docker Engine/Desktop with Docker Compose v2 supporting `up --wait`.
- Free localhost ports 5173, 3000, 5432, 6379, 5672 and 15672. Host worker development also uses 3001.

On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`; changing execution policy is unnecessary. Commands below use `npm` for portability.

## Local development

```sh
npm ci
```

Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell, `cp .env.example .env` on macOS/Linux). Set local database and broker passwords. `.env` is ignored by Git and excluded from Docker builds. Never put credentials in `VITE_*` variables: Vite exposes those to browser code.

Start infrastructure:

```sh
docker compose up -d --wait postgres redis rabbitmq
```

Run these in three separate terminals:

```sh
npm run dev:api
npm run dev:worker
npm run dev:web
```

Open <http://localhost:5173>. The placeholder has no dashboard or application controls. API liveness is available at <http://localhost:3000/health>; worker liveness is at <http://localhost:3001/health> when running on the host. The web proxy makes <http://localhost:5173/api/health> reach the API without requiring CORS.

Backend scripts load the root `.env`; Vite loads it using `envDir`. If changing `API_PORT`, also change `API_PROXY_TARGET` to match. Environment variables already set in the terminal take precedence. M0 does not need database/broker connection URLs because it has no clients for those services yet.

## Full Docker setup

After creating `.env`:

```sh
docker compose config --quiet
docker compose up --build -d --wait --wait-timeout 180
docker compose ps
docker compose logs api worker web
```

Open <http://localhost:5173> and <http://localhost:5173/api/health>. RabbitMQ's local management UI is at <http://localhost:15672>, using the credentials from `.env`.

All six containers have health checks. PostgreSQL, Redis and RabbitMQ must become healthy before the app containers start. App health endpoints report **process liveness only**, not infrastructure connectivity. The worker port is private in Docker; inspect it with:

```sh
docker compose exec worker node -e "fetch('http://127.0.0.1:3001/health').then(r => r.text()).then(console.log)"
```

The `frontend` network connects web and API. The separate `backend` bridge network connects API, worker and infrastructure; web does not join it. It permits outbound access and localhost port publishing for host development. Docker's `internal: true` network mode prevented the infrastructure host ports from being published during verification, so it is not used here. Database and broker host ports are bound to localhost. No service is intended for public deployment. Redis has no password in this local setup.

RabbitMQ health probes run as the `rabbitmq` user through `gosu`. Running an early probe as root can create a root-owned Erlang cookie and prevent the broker from starting.

Compose keeps internal app ports fixed and maps configurable host ports from `.env`. Container service names resolve within their networks, so the container web proxy uses `http://api:3000`, while host development uses `http://127.0.0.1:3000`. The browser always uses the web origin. At M0 this request flow is simply browser → web proxy → API `/health` → JSON response; infrastructure receives no application traffic yet.

Named volumes retain database, Redis AOF and broker data across container recreation. RabbitMQ has a stable hostname so its node identity remains stable. Changing credentials in `.env` does not automatically change accounts stored in existing volumes. `docker compose down` stops the stack and retains data. Avoid `down -v` unless deliberately discarding all local data.

Images build TypeScript and Vite assets once; run `docker compose up --build -d --wait` after source changes. Use host development for hot reload. App processes run as the non-root Node user; the web image gives that user ownership of Vite's temporary configuration cache so preview can start. The image deliberately retains development dependencies for this foundation; Vite preview serves the demo build and is not a production hosting solution.

## Verification

```sh
npm run check
npm run smoke
```

`check` runs ESLint, formatting, strict TypeScript checks, Vitest/Supertest API tests and all three builds. `smoke` requires those builds, starts all three compiled processes on temporary ports, checks API and worker health, checks web HTML and the web-to-API proxy, rejects invalid backend port settings, then stops its child processes. It does not verify Docker or infrastructure.

Use `npm run format` to apply formatting. Source API tests are checked separately from production emit through the test TypeScript config. Do not commit dependencies, `.env`, build output or coverage.

Container readiness and application liveness are different checks: a running process can be healthy while its database is unavailable. Later milestones will add clients, connection failure handling and appropriate readiness checks. No Prisma schema, authentication, mission routes, simulation, Socket.IO, broker jobs or dashboard exists in M0.

The intended later flow is worker → Redis pub/sub → API → Socket.IO clients, with PostgreSQL persistence and RabbitMQ analysis jobs. Those paths remain unimplemented until their respective milestones.
