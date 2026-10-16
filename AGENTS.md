# AERQYN — Codex Development Instructions

You are assisting with AERQYN, a backend-focused UAV digital twin and cybersecurity simulation project.

Read PROJECT.md and TASKS.md before implementing any milestone.

## Working Principles

1. Work on one milestone at a time.
2. Do not implement future milestones without permission.
3. Explain the intended approach briefly before changing code.
4. Prefer simple, maintainable solutions over complex abstractions.
5. Keep the code understandable to a developer learning backend engineering.
6. Do not introduce unnecessary libraries or architectural patterns.
7. Preserve existing functionality when modifying code.
8. Do not invent successful test results or claim features work without verification.

## Code Quality

- Use TypeScript with strict type checking.
- Avoid `any` unless justified.
- Use clear naming and small focused functions.
- Validate external inputs with Zod.
- Handle errors explicitly.
- Keep secrets and credentials out of source control.
- Add tests for important business logic and API behavior.
- Prefer small, reviewable changes.

## Security

- Enforce JWT authentication and RBAC on the backend.
- Do not trust frontend role checks.
- Validate simulation commands and incoming data.
- Never connect to or control real drones.
- All attack simulations must use synthetic local data.

## Git Workflow

- Work in small logical milestones.
- Before committing, review the changed files.
- Run available lint, type-check and test commands.
- Never commit .env files, secrets, node_modules or generated build artifacts.
- Use Conventional Commit messages such as feat:, fix:, test:, docs: and chore:.
- Do not amend commits, force push or rewrite history without permission.
- Do not automatically commit or push unless explicitly requested.
- At the end of each milestone, propose a suitable commit message.

## Learning Workflow

After implementing a milestone, explain:

1. What was built.
2. Which files changed.
3. How data flows through the implementation.
4. How to test the feature.
5. One or two important backend concepts to understand.
6. Any known limitations.

## Milestone Completion

Before declaring a milestone complete:
- Run relevant checks where possible.
- Report test results honestly.
- Identify remaining issues.
- Update TASKS.md.
- Stop and wait for approval before starting the next milestone.