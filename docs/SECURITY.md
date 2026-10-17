# Local security and error-handling review

Reviewed for M6 on 2026-10-17. This is a code review with automated regression
and local-stack checks, not a penetration test or production security certification.

| Boundary             | Controls reviewed                                                                                                                            | Verification                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Authentication       | Salted scrypt passwords; 15-minute HS256 JWT; fixed issuer, audience and algorithm; current user read on each authenticated request          | Login, expired/invalid tokens, deleted user and forged role tests                               |
| Authorization        | Backend Researcher middleware protects CRUD mutations, launch/stop and injection; both roles read shared missions                            | Endpoint, integration, live multi-client and browser checks                                     |
| Input validation     | Strict Zod commands, UUIDs and query selectors; 16 KB JSON/socket limits; bounded pagination, mission duration and pending job count         | Validation and API behavior tests; malformed stored/broker payload tests                        |
| Database and jobs    | Parameterized SQL/Prisma; mission row locks; transactional job acceptance and alert creation; UUID-only broker messages                      | Real PostgreSQL/RabbitMQ tests for races, retries, duplicate/concurrent delivery and stale runs |
| Realtime             | JWT validation at connect/join, before deliveries and every 15 seconds while idle; room/run filtering; viewer leases                         | Real socket clients, room isolation, current-user deletion and viewer cleanup tests             |
| Browser              | Tokens held in memory; React escapes rendered strings; credentials absent from Vite configuration; visible request failures                  | Browser data tests and real browser walkthrough                                                 |
| Errors and logs      | Generic API 500; consistent validation/auth/state errors; configuration logs report field names; known-schema synthetic journal records only | Endpoint error tests, journal rejection/newline/failure tests and parsed container logs         |
| Local infrastructure | Host ports bind localhost; worker port private; application containers run as non-root; secrets ignored by Git/Docker                        | Compose configuration/startup; journal file mode verified as `0600`                             |

`npm audit --omit=dev --audit-level=low` reported **zero known vulnerabilities**
for the installed production dependency graph during verification. This is a
time-specific package advisory result; it does not assess the container OS or
prove that the application has no vulnerabilities.

Final verification corrected two test assumptions: the compiled smoke check
still expected the title from before M5, and the integration test needed to wait
for both Redis subscriptions rather than assuming alert arrival implied telemetry
arrival. No new authentication/authorization bypass was identified in the reviewed
paths. This does not establish exhaustive security coverage.

## Known limits

- This is a trusted local demo. Redis has no password; HTTP, internal PostgreSQL,
  Redis and AMQP connections have no configured TLS. Keep host bindings on
  localhost. The application has shared mission access rather than per-user
  ownership.
- JWTs have no refresh/revocation endpoint. Password reseeding does not revoke
  already issued tokens. Idle socket validation can lag for up to 15 seconds.
- Login limiting is process-local, and web-proxied users share the proxy IP.
  Other endpoints have no general request-rate limiter or per-user storage quota.
- JSONL is a simulation event journal, not a comprehensive security access log.
  It deliberately excludes HTTP headers, tokens, passwords, request bodies and
  arbitrary exception objects. It is neither tamper-proof nor lossless.
- No automatic retention/backup is configured for recordings, jobs, alerts,
  dead letters or journal files. Disk exhaustion can create journal gaps and
  delay anomaly notifications. Health endpoints remain process liveness only.
- Demo images include development dependencies, and Vite preview is not a
  hardened public web server. Public deployment and production hardening are
  outside this project.

All anomalies use local synthetic measurements. There is no connection to or
control of real drones.
