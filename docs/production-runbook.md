# Smart Earning production runbook

## Fresh deployment

Prerequisites are an Ubuntu VPS, DNS A/AAAA records, a dedicated non-root operator, a PostgreSQL database, and secrets in an external password manager. No live action is performed by this document.

1. Set `REPOSITORY_URL`, `DOMAIN`, and `LETSENCRYPT_EMAIL`, then run `ops/bootstrap-production.sh` as the operator. The first run clones into `/var/www/smart-earning3`, installs pinned npm dependencies with `npm ci --include=dev`, creates the explicit Nginx/PM2/firewall prerequisites, and stops if `.env` has not been populated.
2. Populate the mode-0600 `.env` from the secret store. Never place deployer, explorer, local-E2E, or test database secrets in the runtime environment.
3. Run `npm run verify:production-environment`. Critical omissions fail before PM2 starts.
4. Rerun the bootstrap script. The deployment creates an isolated git worktree release, typechecks, builds, verifies artifacts, takes a verified PostgreSQL custom-format backup, applies forward migrations, starts all seven PM2 applications, saves the PM2 boot state, verifies runtime identity, and calls `/api/health/ready`.
5. Verify `systemctl is-enabled pm2-$USER nginx certbot.timer`, `ufw status`, `nginx -t`, `pm2 jlist`, and HTTPS externally.

The Nginx template is `ops/nginx-smart-earning.conf`. Replace every `example.com`; port 3015 must remain loopback-only. Only ports 22, 80, and 443 are public. PostgreSQL and 3015 must not be exposed by the firewall.

## Environment classes

- Required runtime: `DATABASE_URL`, `SESSION_SECRET`, HTTPS `APP_ORIGIN`, `PORT=3015`, RPC URL, chain ID, server/public contract and token addresses, genesis wallet, and deployment block.
- Conditional production: database TLS settings; keeper signer; withdrawal executor, authorizer address and HTTPS URL when withdrawals are enabled.
- Optional: RPC fallbacks, worker feature flags/intervals and disabled-by-default withdrawal flags.
- Development only and forbidden in production: `LOCAL_E2E`, all `*_TEST_DATABASE_URL`, test wallet, deployer key, and explorer API key.
- Dangerous defaults: disabled database TLS over a remote network, localhost origin, placeholder session secrets, and enabled withdrawals without separated executor/authorizer credentials.

## Backup and restore

Bootstrap installs and enables `ops/smart-earning-backup.timer`, which runs the root-owned backup service daily and catches up after downtime. Set `BACKUP_DIRECTORY` to encrypted off-host-backed storage and `BACKUP_RETENTION_DAYS` to policy (14 default). The script uses `umask 077`, `pg_dump -Fc`, validates the archive, writes SHA-256, and prunes expired dumps.

Restore into a new database, never over the only copy:

```bash
createdb --maintenance-db="$DATABASE_URL" smart_earning_restore
pg_restore --no-owner --no-acl --dbname="postgresql:///smart_earning_restore" backup.dump
psql "postgresql:///smart_earning_restore" -c 'select count(*) from schema_migrations'
```

Run application readiness and financial reconciliation against the restored database before changing `DATABASE_URL`. `npm run verify:backup-restore` performs this process against disposable local Docker databases and deletes the restored database afterward.

## Rollback and recovery

- Application rollback: the deployment automatically reloads the previous release for all PM2 applications if post-switch checks fail. Manually use `SMART_EARNING_RELEASE_CWD=<previous> pm2 startOrReload <previous>/ecosystem.config.cjs --update-env && pm2 save`.
- Database rollback: migrations are forward-only. Restore the pre-migration backup into a new database and point the previous release at it after verification.
- Process crash: PM2 restarts with backoff; PostgreSQL locks are connection-scoped and queues are replay-safe.
- VPS reboot: the systemd PM2 unit restores `pm2 save`; Nginx, PostgreSQL connectivity, and `/api/health/ready` must be checked.

## Logging and alerts

PM2 writes timestamped web and per-worker logs under `/var/log/smart-earning`. Bootstrap installs `pm2-logrotate` with 14 retained files, daily rotation, compression, and a 50 MiB maximum size. Nginx access/error logs use `/var/log/nginx/smart-earning.*.log` and the OS logrotate policy. Never log environment values, cookies, signatures, private keys, or database URLs.

Alert on readiness failure, HTTP 5xx rate, authentication/registration 429 spikes, stale worker heartbeat over two intervals, duplicate worker owners, indexer lag, failed queues/retry growth, database storage/connection saturation, expiring TLS certificates, backup age over 25 hours, backup verification failure, and disk usage over 80%.

## Security verification

Nginx and application middleware enforce a 1 MiB body limit, per-IP sensitive-endpoint throttles, same-origin API access, CSP, HSTS, frame denial, MIME sniff prevention, restrictive permissions policy, and referrer policy. Mutating routes retain route-level CSRF origin checks and Zod input validation. Admin routes require an authenticated database-backed administrator session. There are no upload endpoints; multipart uploads are outside the accepted API surface. Database access uses parameterized `pg` queries; dynamic report table names are selected from fixed maps.

## Launch checklist

- VPS identity, patching and non-root operator verified
- UFW exposes only SSH/HTTP/HTTPS
- Nginx configuration and HTTPS certificate verified externally
- PM2 shows exactly seven online processes and saved boot state
- PostgreSQL is private, backed up, monitored, and restore-tested
- Runtime secrets come from the protected `.env`/secret manager
- Latest backup and checksum exist off-host
- Health, worker, indexer and alert dashboards are green
- Previous release and pre-migration backup are recorded
- Reboot and rollback drills have current evidence
