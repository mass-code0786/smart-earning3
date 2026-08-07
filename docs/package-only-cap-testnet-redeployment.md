# Package-only 5X cap: coordinated BSC Testnet redeployment

This runbook is preparation only. Do not execute it against a live environment without an approved maintenance window, verified backups, funded public role addresses, and an explicit decision on testnet state reset.

## Contract and policy

Tracked current deployment: `0xf2F759f3916F18c12Ac5289fe73E79fD68500F8c`, block `123356212`.

The replacement constructor is:

```text
SmartEarning(usdtAddress, genesisUser, admin, treasury, authorizer)
```

Tracked public constructor values are:

- USDT: `0x29c52A2A617EabB3d2A81979B551ECE998fC5774`
- Genesis: `0xfd314f3A6E47a802A73da6d620ab3114f14d042F`
- Admin/deployer: `0xf3a86386FE213901C8e02067c83B8cEb1f3aF508`
- Treasury: `0x66cE23966a5374A5cf42B0FF639C0A909836f371`
- Withdrawal authorizer: `0x36c08FBFDCC8Ec7a9ba406b4889d19bf41282322`

Confirm these values against the approved environment immediately before deployment. Secrets are never recorded in deployment metadata.

The constructor grants the admin `DEFAULT_ADMIN_ROLE`, `KEEPER_ROLE`, `PAUSER_ROLE`, and `WITHDRAWAL_EXECUTOR_ROLE`; grants the treasury `TREASURY_ROLE`; and grants the separate authorizer `AUTHORIZER_ROLE`. After deployment, `configure:roles:testnet` idempotently grants `KEEPER_ROLE` to the address derived from `KEEPER_PRIVATE_KEY` and `WITHDRAWAL_EXECUTOR_ROLE` to the address derived from `AUTO_WITHDRAW_PRIVATE_KEY`.

The package-only policy identifier is `PACKAGE_ONLY_5X_V1`. Genesis and every newly registered wallet start with zero eligible principal and zero earning cap. Successful packages make `totalEligibleValue == totalPackageValue` and add exactly five times the package amount to `totalEarningCap`.

## State boundary

`SmartEarning` is not upgradeable and has no state-import function. A replacement deployment starts with only Genesis registered. It does not inherit:

- registered users, sponsors, direct counts, or matrix parents;
- package ownership or cumulative package value;
- X3 direct cycles/slots or X4 cycles/positions;
- Magic balances, pending allocations, claimable Magic income, or distribution replay state;
- processed Booster top-up references;
- earned-cap totals or capped excess;
- withdrawal reservations, replay protection, paid totals, or withdrawal liquidity.

PostgreSQL also models one registration, referral relation, matrix placement, and package state per user. Reusing the existing active database with a fresh contract would reject or conflict with users registering again. The current architecture therefore supports only these safe choices:

1. Archive the old database and start a fresh migrated testnet database. Existing testnet wallets register and purchase again on the replacement contract.
2. Stop and design a separate state-import contract plus contract-scoped database ownership migration.

Do not switch the application contract address while retaining the old active database. The documented available cutover is option 1. Historical data remains in the read-only archive and is not presented as state belonging to the replacement contract.

Before retiring the old contract, settle or explicitly account for every pending withdrawal. Existing signed authorizations are bound by EIP-712 to the old contract address and cannot be replayed on the new contract. The old contract has no general withdrawal-liquidity recovery function; funded liquidity must be handled through its valid withdrawal mechanism. Fund replacement-contract withdrawal liquidity separately only after role and accounting checks.

## Environment values

Keep and revalidate:

- `BSC_TESTNET_RPC_URL`, `SMART_EARNING_CHAIN_ID=97`
- `BSC_TESTNET_USDT_ADDRESS` and `NEXT_PUBLIC_BSC_TESTNET_USDT_ADDRESS`
- `GENESIS_WALLET`, `TREASURY_WALLET`, `WITHDRAWAL_AUTHORIZER_ADDRESS`
- `DEPLOYER_PRIVATE_KEY`, `KEEPER_PRIVATE_KEY`, `AUTO_WITHDRAW_PRIVATE_KEY`
- `BSCSCAN_API_KEY`

Change after deployment verification:

- `SMART_EARNING_CONTRACT_ADDRESS`
- `NEXT_PUBLIC_SMART_EARNING_CONTRACT_ADDRESS`
- `SMART_EARNING_DEPLOYMENT_BLOCK` (or omit it and use tracked metadata)
- `X3_ALIGNED_CONTRACT_ADDRESS`
- `X3_DIRECT_BOUNDARY_BLOCK` to the new deployment block and `X3_DIRECT_BOUNDARY_LOG_INDEX=-1`
- `DATABASE_URL` to the fresh migrated testnet database for the reset cutover

The generated `deployments/bsc-testnet.json` must be included in the exact application release being built. Server environment, public environment, tracked metadata, and deployment block must agree or startup/indexing must be refused.

## Coordinated order

1. Announce maintenance; disable package/registration traffic and stop PM2 application plus all workers. Keep `AUTO_WITHDRAW_ENABLED=false` and `WITHDRAWAL_BROADCAST_ENABLED=false`.
2. Record the current Git commit, environment fingerprint, old deployment metadata, indexer checkpoint, module states, queue counts, pending withdrawals, and old-contract balances. Never print secrets.
3. Create and verify a PostgreSQL backup. Apply migration 033 to the old database only if the old database is to be retained as corrected historical audit data. Verify its reconciliation counts and historical-excess totals, then mark that database read-only/archive for the cutover.
4. Create a fresh testnet database and run all migrations through 033. Confirm migration 033 is present, the reconciliation table/trigger exist, and no application users or financial movements were copied from the old contract database.
5. From the approved release commit, run `preflight:deploy:testnet`. Confirm the intended USDT, Genesis, treasury, authorizer, deployer, chain 97, disabled withdrawal broadcasting, and funded deployer.
6. Set `SMART_EARNING_DEPLOY_CONFIRM=DEPLOY_PACKAGE_ONLY_CAP_TESTNET` for one command and run `deploy:unified:testnet`. Unset it immediately. Preserve the generated address, transaction, block, policy, constructor values, and bytecode hash in both canonical `deployments/bsc-testnet.json` and X3-alignment `deployments/bsc-testnet-x3-aligned.json` metadata.
7. Update server/public contract addresses temporarily for tooling. Set `SMART_EARNING_ROLE_CONFIRM=CONFIGURE_PACKAGE_ONLY_CAP_TESTNET`, run `configure:roles:testnet`, then unset it.
8. Run `verify:smart-earning:testnet` on BscScan and `check:deployment:testnet`. The latter must prove metadata/address/bytecode consistency, zero Genesis cap, treasury and USDT identity, and all admin/keeper/pauser/treasury/executor/authorizer roles.
9. With a fresh funded disposable wallet, set `CAP_POLICY_VERIFY_CONFIRM=VERIFY_PACKAGE_ONLY_CAP_TESTNET`, run `verify:cap-policy:testnet`, then unset it. This intentionally creates testnet transactions and must prove registration cap 0, package 1 cap 40 USDT, and packages 1+2 cap 120 USDT.
10. Point the application release at the fresh database. Run `seed:genesis`. Set the new contract/deployment/X3 environment values. Activate contract-aligned X3 at the new deployment boundary only after the fresh database migrations and metadata agree.
11. Build the exact release containing the generated deployment metadata. Run production-environment validation, schema readiness, and application tests before PM2 startup.
12. Start the indexer first at the replacement deployment block and verify its checkpoint/address. Start the web application, then workers one at a time: Magic funding/distribution, X3 hold expiry, Booster, Dividend, and Withdrawal last. Keep withdrawal broadcasting disabled until liquidity, executor, authorizer, and queue checks pass.
13. Verify health/readiness, Genesis projection, registration preflight, one fresh registration, package 1 and 2 projections, X3/X4 events, Magic funding/distribution queues, Booster/Autopool/Dividend isolation, zero duplicate projections, and no critical alerts.
14. Enable user traffic. Enable automatic withdrawal and broadcast only under a separate approval after the new contract is funded and end-to-end withdrawal verification passes.

## Migration 033 safety

Migration 033 uses only confirmed package purchases for package principal. It creates one `PACKAGE_ONLY_5X_V1` audit row per user, preserves historical income and cap ledgers, records historical earnings above the corrected cap, sets remaining cap no lower than zero, and installs an append-only trigger. Its unique `(user_id, policy_version)` key makes repeat execution non-mutating after the first successful transaction.

Do not treat migration 033 as an on-chain state migration. It only reconciles PostgreSQL cap projections.
