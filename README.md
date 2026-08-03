# Smart Earning

The existing neon-green/black/glass frontend is preserved and uses one unified
BNB Smart Chain contract for registration, packages, accounting, treasury
forwarding, Magic distribution, and treasury-funded withdrawals.

Chain ID is fixed to BNB Testnet (`97`), the deployment script refuses other
chains, registration uses exactly 2 USDT token units, and BNB gas remains a
separate wallet charge. No Mainnet deployment is configured.

## Setup

1. Copy `.env.example` to `.env.local` and configure PostgreSQL, BNB Testnet RPC,
   a chosen testnet USDT token, genesis wallet, and secrets.
2. Run `npm run migrate` and `npm run seed:genesis`.
3. Run `npm test`.
4. With a funded Testnet-only deployer, run `npm run deploy:testnet`, then copy
   its single address to the server and `NEXT_PUBLIC_` environment variables.

All user payments enter the unified contract and are forwarded in full to the
configured treasury in the same transaction. Withdrawal liquidity is funded
separately by the treasury and payouts are executed only by the unified contract.

Production PM2 runs `npm run magic-distribution:worker`, which checks the current
on-chain daily cycle continuously and executes it once shortly after 00:00 UTC.
`POST /api/keeper/distribute` remains an authenticated manual trigger; both paths
share one worker lock and the same idempotent cycle records. Run `npm run indexer`
continuously or on a short schedule to backfill confirmed registration events.
# Local end-to-end environment

Run the complete isolated Smart Earning stack with:

```bash
npm run local:e2e
```

The command creates a new uniquely named PostgreSQL database, starts Hardhat on
`127.0.0.1:8545` with chain ID `31337`, deploys Mock USDT and the unified
SmartEarning contract, funds deterministic local accounts, executes the
registration/package/referral/Booster/withdrawal scenario, starts the
production frontend/backend on `127.0.0.1:3020`. The self-terminating verifier
does not start production financial workers. Press Ctrl+C to stop the processes.

For a self-terminating CI verification run:

```bash
npm run local:e2e:verify
```

Evidence is written to `evidence/local-e2e/`. The runner refuses non-local
PostgreSQL hosts and refuses any chain ID other than 31337. Hardhat accounts
and keys are public test fixtures and must never receive real assets.
