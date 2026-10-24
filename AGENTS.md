# ComsFlow WMS v2

This is a separate project. Do not alter or deploy the legacy Railway repository.

- Preserve the ComsFlow branding and operational UI unless a requested change requires it.
- React + Vite frontend and portable API run on Cloudflare Workers.
- Supabase provides PostgreSQL, Auth, and private Storage. Browser code must never contain service-role keys or DATABASE_URL.
- File parsers stay in isolated src/worker workers. Outbound PDF can run in a browser module worker for the owner's direct-import workflow; legacy server parsing, Excel and reports run in Node child processes. Do not import PDF/Excel parsers into the Cloudflare handler.
- Upload original files directly to private Storage; persist jobs in Postgres. Never mark a scan/import successful before a committed server response.
- Keep scan request idempotency, role/warehouse checks, and audit history. Database transactions are authoritative.
- Never run fixtures on real data. Tests require a dedicated local database with a name ending _test.
- Never run data migration or cleanup against production without a verified plan, backup, and explicitly selected target. Source migration is read-only.
- Required validation: npm run typecheck, npm run lint, npm test, npm run build, npm run build:worker, wrangler deploy --dry-run.
- Use docs/DEPLOYMENT.md for configuration; do not claim production deployment until credentials, migrations, worker heartbeat, and live acceptance checks are confirmed.
