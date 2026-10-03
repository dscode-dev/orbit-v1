# Sprint 22.6–22.8 — External Production-Readiness Closure

Date: 2026-07-10  
Environment: external Orbit ERP installation at `erp.allblue-labs.com`  
Server: `ninja@allblue-labs.contabo` / `184.174.35.158`  
Application path: `/opt/allblue-labs/apps/erp-operation`  
Final verdict: `ORBIT_RELEASE_CANDIDATE_NOT_READY`

This report records the final external production-readiness closure for Orbit ERP across:

- Sprint 22.6 — External Environment Provisioning & CI Artifact Pipeline
- Sprint 22.7 — External RC Certification Execution
- Sprint 22.8 — Disaster Recovery & Rollback Certification

The active production/customer database was protected. No destructive database operation was
executed against the active database. No `migrate reset`, `drop`, `truncate`, destructive seed, or
data replacement was executed against the active database.

## 1 External Environment Summary

- Host OS: Ubuntu 24.04.4 LTS.
- Hostname: `vmi3296764`.
- Kernel: Linux 6.8.0-106-generic.
- Runtime: Docker 29.4.3, Docker Compose v5.1.3.
- Application path: `/opt/allblue-labs/apps/erp-operation`.
- Deployed commit: `6daf0cc9fe87d836adbe3af2a85b3be4db4a2ffb`.
- Services: `postgres`, `api`, `frontend`.
- PostgreSQL image: `postgres:17-alpine`.
- API image id after closure: `sha256:4511fe183c3a6c54996928960c6dba1c85213c3d84d214eb2c01f4577e2ecccc`.
- Frontend image id after closure:
  `sha256:dff3227afa34b4ace7f6f5bed8b17c834a35ccb6f5777b3619e3d11d6e48ca6d`.
- Persistent volumes:
  - PostgreSQL: `erp-operation_postgres_data`
  - API storage: `erp-operation_api_storage`

## 2 Safety Preflight Results

Safety preflight was executed before runtime changes.

Verified:

- Current container topology.
- Persistent PostgreSQL volume.
- Persistent API storage volume.
- Runtime env flags.
- Migration status.
- Current external exposure.

Initial critical findings before correction:

- `NODE_ENV=development`.
- `ENABLE_DEMO_DATA=true`.
- `ENABLE_DEMO_ENDPOINTS=true`.
- API was publicly bound on `0.0.0.0:4040`.
- PostgreSQL was publicly bound on `0.0.0.0:5432`.
- Frontend was publicly bound on `0.0.0.0:3030`.

Corrective action performed after backup:

- `.env` changed to production mode.
- Demo data/endpoints disabled.
- PostgreSQL, API and frontend Docker port bindings changed to `127.0.0.1`.

Post-correction effective API env:

- `NODE_ENV=production`
- `ENABLE_DEMO_DATA=false`
- `ENABLE_DEMO_ENDPOINTS=false`
- `STORAGE_PROVIDER=local`
- `STORAGE_DRIVER=local`
- `STORAGE_PATH=/app/storage`

## 3 Production Database Protection Evidence

Active database protection actions:

- Migration status inspected before deployment.
- PostgreSQL backup created before runtime changes.
- Storage backup created before runtime changes.
- No destructive database operation executed against the active database.
- Restore verification used an isolated temporary database named
  `orbit_restore_verify_20260710T122504Z`.
- Temporary restore database was dropped after verification.

Migration status:

- Prisma schema loaded from `prisma/schema.prisma`.
- Database: `minha_empresa_db`.
- Migrations found: 23.
- Result: `Database schema is up to date!`

## 4 Backup Results

Backup directory:

`/opt/allblue-labs/backups/erp-operation/rc-closure-20260710T121311Z`

PostgreSQL:

- Backup file: `postgres.dump`
- Size: `228K`
- Verified by `pg_restore --list`.
- Object list count: 461.

Storage:

- Backup file: `storage.tgz`
- Size: `84K`
- Backup duration: 1 second.
- Verified by `tar -tzf`.

## 5 Storage Persistence Results

Runtime storage:

- API volume: `erp-operation_api_storage`.
- Host source: `/var/lib/docker/volumes/erp-operation_api_storage/_data`.
- Container destination: `/app/storage`.

Storage restore verification:

- Restore path: `/opt/allblue-labs/restore-tests/erp-operation-storage-20260710T122533Z`.
- Restore duration: 0 seconds.
- Archive entries: 41.
- Restored files: 11.
- Restored size: `248K`.

Storage was not restored into the active production path.

## 6 CI Execution Results

CI could not be certified as passing for the deployed commit.

Evidence:

- Workflow exists: `.github/workflows/release-candidate.yml`.
- Workflow name: `Orbit Release Candidate Gate`.
- Jobs defined:
  - Backend quality, migrations and regressions.
  - Frontend quality and production build.
- GitHub workflow run lookup for commit `6daf0cc9fe87d836adbe3af2a85b3be4db4a2ffb`
  returned no pull-request-triggered workflow runs through the available GitHub connector.

Result:

- CI evidence is incomplete.
- This remains a release blocker.

## 7 Artifact Traceability

Deployed source commit:

`6daf0cc9fe87d836adbe3af2a85b3be4db4a2ffb`

Deployed images:

- API: `sha256:4511fe183c3a6c54996928960c6dba1c85213c3d84d214eb2c01f4577e2ecccc`
- Frontend: `sha256:dff3227afa34b4ace7f6f5bed8b17c834a35ccb6f5777b3619e3d11d6e48ca6d`

Traceability gaps:

- Images are local Docker images, not immutable registry artifacts.
- No registry digest tied to CI was verified.
- Remote working tree now contains an uncommitted infrastructure correction in
  `docker-compose.yml`.

Result:

- Artifact traceability is not release-candidate complete.

## 8 DNS/TLS/Proxy Results

Verified:

- `https://erp.allblue-labs.com/login` returned HTTP 200 through Cloudflare.
- `https://erp.allblue-labs.com/api/v1/health` returned HTTP 200 through Cloudflare.
- `http://erp.allblue-labs.com/login` redirected to HTTPS with HTTP 301.
- TLS certificate:
  - Subject: `CN = allblue-labs.com`
  - Issuer: Let's Encrypt `YE2`
  - Validity: 2026-07-03 to 2026-10-01

Observed response headers include:

- `Strict-Transport-Security`
- `Content-Security-Policy`
- `X-Content-Type-Options`
- `X-Frame-Options`
- `X-Request-Id`
- rate-limit headers

Local DNS resolution was intermittent during validation, but the server-side and successful external
HTTPS checks confirm that the public endpoint is functional.

## 9 Firewall and Exposure Results

Initial exposure before correction:

- API: `0.0.0.0:4040`
- Frontend: `0.0.0.0:3030`
- PostgreSQL: `0.0.0.0:5432`

Corrected exposure after closure:

- API: `127.0.0.1:4040`
- Frontend: `127.0.0.1:3030`
- PostgreSQL: `127.0.0.1:5432`

External direct IP checks after correction:

- `http://184.174.35.158:4040/api/v1/health`: timed out.
- `184.174.35.158:5432`: timed out.

Remaining exposure finding:

- `https://erp.allblue-labs.com/api/v1/metrics` returns HTTP 200 publicly through Cloudflare.

Result:

- Direct service exposure was corrected.
- Public metrics exposure remains a release blocker.

## 10 Deployment Results

Deployment action:

- `docker compose up -d --build`
- followed by a targeted `docker compose up -d --no-build api frontend` after loopback bind
  correction.

Post-deploy status:

- `erp-operation-api-1`: healthy.
- `erp-operation-frontend-1`: running.
- `erp-operation-postgres-1`: healthy.

Migration result after deployment:

- 23 migrations found.
- Database schema is up to date.

## 11 External Smoke Results

Verified:

- `GET https://erp.allblue-labs.com/api/v1/health`: HTTP 200.
- Response:
  - `success: true`
  - `status: ok`
  - `database_connection: connected`
  - `storage_connection: available`
  - `version: 0.1.0`
- `HEAD https://erp.allblue-labs.com/login`: HTTP 200.

Not fully verified:

- Authenticated frontend workflows were not executed because no production-safe test credentials
  were available.

## 12 Critical Workflow Results

Critical authenticated workflows were not executed.

Reason:

- No dedicated production-safe certification user credentials were available.
- The active customer database contains real/customer-accessible data.
- Creating privileged users, seeding, or modifying customer data for certification would violate the
  safety constraints of this closure.

Result:

- Critical workflow validation remains incomplete.

## 13 Restart Persistence Results

Action:

- `docker compose restart api frontend`.

Result:

- API returned healthy after restart.
- Frontend returned running after restart.
- PostgreSQL remained healthy.
- Health validation after restart succeeded.
- Restart validation duration: 12 seconds.

## 14 Proxy and Rate-Limit Results

Proxy:

- HTTPS routing through Cloudflare to the application was verified.
- Security headers and `X-Request-Id` were present.

Rate limit:

- Rate-limit headers were present:
  - `X-Ratelimit-Limit: 100`
  - `X-Ratelimit-Remaining`
  - `X-Ratelimit-Reset`

Not executed:

- Aggressive rate-limit exhaustion test was not executed to avoid impacting the live customer
  environment.

## 15 External Performance Results

Observed lightweight health timing:

- `GET /api/v1/health`: approximately `0.794s` from external validation environment.

Host resources:

- Disk: 193G total, 67G used, 127G available, 35% usage.
- Memory: 11Gi total, 9.3Gi available.
- Container memory snapshot:
  - API: ~59.55MiB.
  - Frontend: ~53.37MiB.
  - PostgreSQL: ~45.56MiB.

No load test was executed against the live customer environment.

## 16 Observability Results

Verified:

- Structured API logs are emitted.
- Startup logs are present.
- Request logs include `requestId`, method, path, status and duration.
- `/api/v1/metrics` emits Prometheus-format metrics.

Finding:

- Metrics endpoint is publicly accessible through the production HTTPS endpoint.

## 17 PostgreSQL Restore Results

Restore target:

- Isolated temporary database: `orbit_restore_verify_20260710T122504Z`.

Restore result:

- `pg_restore` completed successfully.
- Restore duration: 3 seconds.

Verification counts from restored database:

- `users`: 5.
- `equipments`: 7.
- `operations`: 3.
- `organizations`: 1.

Cleanup:

- Temporary restore database was dropped after verification.

## 18 Storage Restore Results

Restore target:

- `/opt/allblue-labs/restore-tests/erp-operation-storage-20260710T122533Z`

Result:

- Restore completed successfully.
- Restore duration: 0 seconds.
- Archive entries: 41.
- Restored files: 11.
- Restored size: `248K`.

The active storage volume was not modified.

## 19 Rollback Drill Results

Rollback was not certified.

Reasons:

- No immutable registry artifact from the previous release was verified.
- No CI-produced image digest was available.
- The current deployment relies on locally built `latest` images.
- A live rollback would require a known-good previous artifact and explicit maintenance window.

Result:

- Rollback remains a release blocker.

## 20 RTO/RPO Results

Measured recovery-related timings:

- Storage backup: 1 second.
- PostgreSQL restore into isolated database: 3 seconds.
- Storage restore into isolated path: 0 seconds.
- API/frontend restart validation: 12 seconds.

Not certified:

- Full production RTO.
- Full production RPO.
- End-to-end rollback RTO.

Reason:

- No immutable rollback artifact was verified.
- No full cutover/rollback drill was performed.

## 21 Files Created

Local repository:

- `docs/release/SPRINT_22_6_22_8_EXTERNAL_PRODUCTION_CLOSURE.md`

Remote server:

- `/opt/allblue-labs/backups/erp-operation/rc-closure-20260710T121311Z/postgres.dump`
- `/opt/allblue-labs/backups/erp-operation/rc-closure-20260710T121311Z/postgres.dump.list`
- `/opt/allblue-labs/backups/erp-operation/rc-closure-20260710T121311Z/storage.tgz`
- `/opt/allblue-labs/restore-tests/erp-operation-storage-20260710T122533Z`
- Remote compose backup files:
  - `docker-compose.yml.pre-rc-closure-20260710T121728Z`
  - `docker-compose.yml.pre-loopback-fix-20260710T122400Z`

## 22 Files Modified

Local repository:

- `docs/release/SPRINT_22_6_22_8_EXTERNAL_PRODUCTION_CLOSURE.md`

Remote server:

- `/opt/allblue-labs/apps/erp-operation/.env`
- `/opt/allblue-labs/apps/erp-operation/docker-compose.yml`

Remote `.env` changes:

- `NODE_ENV=production`
- `ENABLE_DEMO_DATA=false`
- `ENABLE_DEMO_ENDPOINTS=false`
- `NEXT_PUBLIC_ENABLE_DEMO=false`

Remote `docker-compose.yml` changes:

- PostgreSQL bound to `127.0.0.1:5432`.
- API bound to `127.0.0.1:4040`.
- Frontend bound to `127.0.0.1:3030`.

## 23 Infrastructure Changes

Applied:

- Closed public PostgreSQL Docker port exposure.
- Closed public API Docker port exposure.
- Closed public frontend Docker port exposure.
- Disabled demo data and demo endpoints in the external runtime.
- Recreated API/frontend containers after loopback bind correction.

Not applied:

- No firewall rule changes were made.
- No Nginx/Cloudflare configuration changes were made.
- No database schema changes were made.

## 24 Commands/Validations Executed

Representative validations executed:

- `hostnamectl`
- `docker version`
- `docker compose version`
- `docker compose ps`
- `docker ps`
- `docker inspect`
- `docker compose config`
- `docker compose exec api npx prisma migrate status --schema prisma/schema.prisma`
- `pg_dump`
- `pg_restore --list`
- `tar -czf`
- `tar -tzf`
- `docker compose up -d --build`
- `docker compose up -d --no-build api frontend`
- `docker compose restart api frontend`
- `curl -k -I https://erp.allblue-labs.com/api/v1/health`
- `curl -k -I https://erp.allblue-labs.com/login`
- `curl -k -I https://erp.allblue-labs.com/api/v1/metrics`
- direct IP checks against `184.174.35.158:4040` and `184.174.35.158:5432`
- isolated PostgreSQL restore and verification queries
- isolated storage restore

## 25 Findings by RC0/RC1/RC2/RC3

RC0:

- None confirmed after closure.

RC1:

- `RC1-CI-001`: CI execution evidence missing for deployed commit.
- `RC1-TRACE-001`: deployed images are not immutable registry artifacts tied to CI.
- `RC1-METRICS-001`: `/api/v1/metrics` is publicly accessible.
- `RC1-WORKFLOW-001`: authenticated critical workflows were not executed with a production-safe
  certification user.
- `RC1-ROLLBACK-001`: rollback drill not certified.
- `RC1-IAC-001`: external exposure correction exists as an uncommitted remote infra change.

RC2:

- `RC2-DNS-001`: intermittent local DNS resolution during validation.
- `RC2-RATE-001`: rate-limit headers verified, but exhaustion behavior not tested against live
  environment.

RC3:

- `RC3-OBS-001`: observability exists, but metrics publication policy needs tightening before V1
  release.

## 26 Remaining Blockers

- CI must pass for the exact release commit and be recorded.
- API/frontend/postgres loopback binding correction must be committed and deployed through the
  official release path.
- Images must be pushed to an immutable registry and traced back to CI and commit SHA.
- `/api/v1/metrics` must be restricted to an approved private/internal path or protected access
  mechanism.
- A production-safe certification user/process must be available for authenticated critical workflow
  smoke tests.
- Rollback must be executed against a known-good immutable artifact.
- Full RTO/RPO must be certified through a complete drill.

## 27 Final Verdict

`ORBIT_RELEASE_CANDIDATE_NOT_READY`

The external environment is substantially healthier after this closure: production mode is active,
demo endpoints are disabled, direct public exposure of PostgreSQL/API/frontend was closed, backups
were created, PostgreSQL restore was verified in an isolated database, storage restore was verified
in an isolated path, and restart persistence was validated.

The release candidate cannot be approved yet because CI evidence, immutable artifact traceability,
public metrics protection, authenticated workflow certification and rollback certification remain
open blockers.
