# Phase 4 launch audit

Audit date: 2026-07-31. Evidence is local/disposable only; no live VPS or production data was touched.

Grades: A = fully production ready in the tested scope; B = ready but live verification is outstanding; C = partially complete; D = missing.

| Area | Grade | Evidence / remaining verification |
|---|---:|---|
| Fresh source, `npm ci`, typecheck and production build | A | Rehearsed in a clean disposable source tree. |
| Forward migrations | A | All 26 migrations applied to disposable databases. |
| PM2 seven-process topology and single ownership | A | Static and regression-tested; Phase 3 recovery evidence retained. |
| PM2 systemd boot recovery on target VPS | B | Bootstrap automates it; actual reboot requires the target host. |
| Nginx reverse proxy and request-size limit | A | `nginx -t` passed in a disposable Nginx container. |
| Public DNS and trusted SSL issuance/renewal | B | Certbot is automated; DNS and public issuance require the target host. |
| Liveness/readiness checks | A | Public process and database/migration endpoints build and test cleanly. |
| Atomic deployment and application rollback | A | All PM2 applications switch together and rollback code is regression-tested. |
| Database rollback drill | B | Pre-migration backup is automatic; production cutover to a restored DB remains a live drill. |
| Required environment fail-closed validation | A | Missing/insecure/mismatched/test-only settings prevent PM2 startup. |
| Authentication, registration and admin throttling | A | Application per-IP limits plus Nginx API limiting are tested. |
| CSRF, CORS/origin, cookies and admin authorization | A | Route and middleware suites pass. |
| CSP and browser security headers | A | Tested CSP, HSTS, frame denial, MIME, referrer and permissions policies. |
| Input/body/upload validation | A | Zod route validation, 1 MiB application/Nginx limits; no upload endpoint exists. |
| SQL injection and XSS resistance | A | Parameterized SQL/fixed dynamic maps; React escaping plus CSP. |
| Verified PostgreSQL backup and disposable restore | A | Custom dump, archive validation, checksum, 26 migrations and 89 tables verified. |
| Scheduled backups and retention | A | Persistent systemd timer, restrictive service and 14-day default retention are automated. |
| Encrypted off-host backup replication | B | Destination must be connected to the operator's selected provider. |
| PM2/Nginx worker log files and rotation | A | Explicit per-process files; automated PM2 rotation; OS Nginx rotation. |
| Fully structured JSON logging | C | Operational events are structured objects, but not every framework line is JSON. |
| Alert conditions and health surfaces | C | Conditions/endpoints exist; external paging transport and receivers are not configured. |
| Production runtime dependency vulnerabilities | A | `npm audit --omit=dev --audit-level=high`: zero vulnerabilities. |
| Concurrent dashboard users | A | 50/50 HTTP 200; p95 493.5 ms; no transport/server failures. |
| Concurrent wallet requests | A | 50/50 HTTP 200; p95 282.6 ms; no transport/server failures. |
| Concurrent indexer health during active indexing | A | 20/20 HTTP 200; p95 85.4 ms while the standalone indexer held its lock. |
| Concurrent valid production registrations | C | Ten concurrent requests were safely rejected on local chain 31337; a valid chain-97 load drill needs a disposable BSC-compatible environment. |
| Database contention measurement | C | No failures occurred, but the sampled wait count includes idle client waits and is not a definitive lock-contention measure. |
| VPS identity/patching/firewall | B | Bootstrap configures UFW; target-host inspection is intentionally outstanding. |
| Secret manager population and rotation | B | Fail-closed contract and mode-0600 file are ready; operator provider/rotation drill is outstanding. |

Weighted completion: **87%** (19 A, 6 B, 4 C, 0 D; A=100%, B=75%, C=40%, D=0%). Launch recommendation: **Private Alpha** until all B items are verified on a staging/VPS analogue and the performance/observability C items are closed. Overall **PHASE 4 FAIL** for public launch readiness because production-host and external operational evidence is intentionally unavailable under the no-deploy constraint.
