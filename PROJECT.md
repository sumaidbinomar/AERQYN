# AERQYN — Project Specification

## Overview

AERQYN is a real-time UAV Digital Twin and Cybersecurity Simulation Platform.

It simulates a small fleet of virtual drones, streams telemetry in real time, detects synthetic sensor anomalies, and visualizes how distributed backend services process flight data and security events.

This is a backend-focused project combining secure REST APIs, relational databases, WebSockets, Redis, RabbitMQ, JWT authorization, Docker Compose and automated tests.


## Tech Stack

- Frontend: React, Vite, TypeScript, Tailwind CSS
- Backend: Node.js, Express, TypeScript
- Database: PostgreSQL with Prisma ORM
- Real-time communication: Socket.IO
- In-memory caching: Redis
- Message broker: RabbitMQ
- Authentication: JWT
- Validation: Zod
- Testing: Vitest and Supertest
- Infrastructure: Docker Compose

## Core Functionality

### 1. Authentication and RBAC

Use seeded demo accounts with two roles:

- Researcher: create, edit, delete, launch and stop simulations; inject anomalies.
- Observer: view simulations, telemetry and alerts without modifying them.

Protect API routes with JWT authentication and role-based middleware.

### 2. Mission Management

Implement RESTful CRUD operations for simulation missions.

Each mission contains:
- ID
- Name
- Description
- Status
- Created timestamp
- Simulation settings

Validate request bodies with Zod.

### 3. Virtual Drone Simulation

Simulate three drones moving along predefined 2D routes.

Each drone produces:
- Position X/Y
- Speed
- Battery percentage
- Connection status
- Timestamp

Use simple deterministic movement rather than real flight physics.

### 4. Real-Time Telemetry

Use Socket.IO to broadcast telemetry to mission-specific rooms.

Use Redis to cache the latest drone states and active connected viewers.

Store selected telemetry snapshots in PostgreSQL for replay.

### 5. Cybersecurity Anomaly Simulation

Allow the Researcher to inject:
- GPS position jump
- Sudden battery drop
- Communication loss

These are simulated anomalies, not real cyberattacks.

Implement rule-based detection for the MVP. Do not introduce machine-learning model training.

### 6. RabbitMQ Background Processing

Use RabbitMQ for asynchronous anomaly-analysis jobs.

A separate worker consumes jobs, analyzes the event, and persists detected alerts.

Use durable queues, manual acknowledgements and idempotent processing where practical.

### 7. Event Logging and Replay

Store timestamped event records in append-only JSONL files on persistent Docker volumes.

Save selected telemetry snapshots and alerts in PostgreSQL.

Provide a basic replay view using recorded snapshots.

### 8. Frontend

Build a polished dark-themed simulation laboratory.

Screens:
- Login
- Main simulation dashboard
- Mission details with telemetry and history

Dashboard components:
- Animated 2D drone field
- Drone telemetry cards
- Mission controls
- Anomaly injection controls
- Real-time alert feed
- Basic telemetry history/replay

Use a futuristic aerospace aesthetic with navy, cyan and restrained amber/red alert colors.

## Architecture

Use two backend services:

1. API service: Express REST endpoints, JWT, RBAC, validation, Socket.IO and database access.
2. Worker service: simulation generation, RabbitMQ consumption and anomaly analysis.

Infrastructure:
- PostgreSQL
- Redis
- RabbitMQ

The worker publishes relevant state changes through Redis pub/sub so the API can broadcast them to Socket.IO clients.

Use Docker Compose with separate frontend-facing and private backend networks where practical.

## Non-Goals

Do not implement:
- Physical drone connectivity
- Real GPS maps
- 3D simulation
- Advanced flight physics
- Machine-learning model training
- Payments
- Email notifications
- Cloud deployment
- Complex user registration
- More than three initial drones

## Engineering Requirements

- Modular, understandable TypeScript
- No hardcoded secrets
- Environment variables with an example file
- Consistent API error responses
- Proper request validation
- Authorization on protected routes
- Automated endpoint tests
- Docker health checks where practical
- Clear README and architecture documentation
- Meaningful Git commits after verified milestones

## Definition of Done

The MVP is complete when:

1. Docker Compose starts the required infrastructure and services.
2. Demo users can log in with appropriate permissions.
3. Missions support validated CRUD operations.
4. Three drones move in a simulated 2D environment.
5. Two browser sessions receive live telemetry.
6. Redis caches current state and viewer presence.
7. Injected anomalies are processed asynchronously through RabbitMQ.
8. Detected alerts appear live and persist.
9. JSONL logs contain timestamped events.
10. Automated API tests pass.
11. The README explains setup, architecture, API routes and demo steps.

Prioritize correctness and demonstrable functionality over additional features.