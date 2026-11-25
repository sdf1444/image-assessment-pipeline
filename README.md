# Image Assessment Lab

A local-first, **non-clinical** image assessment demo. React uploads PNG/JPEG files to a NestJS API; a separate worker claims jobs from a durable MariaDB queue, runs a deterministic mock model, and stores the model version with the result. The scores are not medical predictions.

For step-by-step usage, see the [user guide](docs/user-guide.md).

## Architecture

The API and worker share a MariaDB database and local upload directory. The schema is applied only when the Docker volume is first created. The worker emits JSON events with job IDs, attempts and model versions. An admin can query `GET /api/metrics` with a bearer token for counts and retries by current job status.

Claims use database row locks and a 30-second lease. Completion checks the lease token inside a transaction, and the database enforces one assessment per job, preventing stale workers from overwriting results.

## Validation

```powershell
npm run build
npm test
```

For integration testing, use a **dedicated disposable** database and the API and worker started against it; then run `npm run test:integration --workspace backend` with the same `.env`. The integration test creates jobs and sessions in that database.

## Boundaries and next steps

This is a local learning project, not production healthcare software. The queue is MariaDB-backed rather than SQS, files are stored locally rather than S3, and no Terraform deployment is provided. There is no management UI, distributed rate limiter, audit system, HTTPS termination, secret manager, or production monitoring/exporter. The in-memory login limiter is per API process; session tokens are bearer credentials and must be protected by HTTPS in any deployment. Expired sessions are rejected but are not automatically purged. A production web server must serve the SPA entry point for both `/login` and `/dashboard`.

For a cloud deployment, use private object storage, a transactional outbox with SQS, managed secrets, TLS, infrastructure-as-code, centralized metrics/logging and alerting, explicit retention and access policies, a migration system, and a security review. Preserve the lease/fencing and unique-result invariants when changing queue or storage providers.
