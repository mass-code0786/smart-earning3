# X3 aligned-contract testnet deployment plan

## Decision and authority

The current deployed contract cannot represent the direct-referral X3 plan, so a new contract deployment is required. The replacement contract records package ownership and direct-cycle facts. PostgreSQL remains the only X3 financial authority: earning cap, Income Wallet, Magic Wallet, holds, releases, and flushes are not executed by the contract.

The replacement is a new, non-upgradeable deployment. Old FIFO queue/recycle storage is absent from the new bytecode; it remains queryable only at the historical contract address. X4, Magic, Booster, Dividend, withdrawal, registration, package ordering, treasury forwarding, and their existing roles remain unchanged.

Do not use this runbook against production. Do not change `X3_ROLLOUT_MODE` from `TRANSITIONAL` until the deployed bytecode, verified source, ABI, boundary, and rollback snapshot have been reviewed.

## Constructor and roles

Constructor order:

1. `USDT_ADDRESS`
2. `GENESIS_ADDRESS`
3. deployer/admin address
4. `TREASURY_ADDRESS`
5. `WITHDRAW_AUTHORIZER_ADDRESS`

The deployer receives admin, keeper, pauser, and withdrawal-executor roles. Treasury receives the treasury role. The distinct authorizer receives the authorizer role. The deployment script requires BSC Testnet (chain ID 97), the repository's expected testnet deployer, and the literal confirmation `X3_DEPLOY_CONFIRM=DEPLOY_X3_ALIGNED_TESTNET`.

## Preparation and read-only checks

Set these in a testnet-only shell or secret store:

```text
BSC_TESTNET_RPC_URL=...
DEPLOYER_PRIVATE_KEY=...
BSCSCAN_API_KEY=...
BSC_TESTNET_USDT_ADDRESS=...
GENESIS_WALLET=...
TREASURY_WALLET=...
WITHDRAW_AUTHORIZER_ADDRESS=...
X3_ROLLOUT_MODE=TRANSITIONAL
```

Run locally:

```powershell
npm run contract:compile
npm run contract:test
npm run typecheck
npm test
npm run build
git diff --check
```

Review the artifact, constructor arguments, deployer balance, role addresses, and current package prices before authorizing any transaction.

## Testnet deployment and verification commands

These commands are prepared but must not be run during the planning phase:

```powershell
$env:X3_DEPLOY_CONFIRM='DEPLOY_X3_ALIGNED_TESTNET'
npm run deploy:x3-aligned:testnet
npm run verify:x3-aligned:testnet
npm run check:x3-aligned:testnet
```

Deployment metadata is written to `deployments/bsc-testnet-x3-aligned.json`; it does not replace the active deployment metadata. The check script is read-only and compares deployed bytecode and constructor state with that metadata.

## Address replacement and rollout boundary

After verification, set the testnet backend variables, while keeping rollout mode transitional:

```text
SMART_EARNING_CONTRACT_ADDRESS=<new verified address>
NEXT_PUBLIC_SMART_EARNING_CONTRACT_ADDRESS=<new verified address>
X3_ALIGNED_CONTRACT_ADDRESS=<same new verified address>
X3_DIRECT_BOUNDARY_BLOCK=<deployment block>
X3_DIRECT_BOUNDARY_LOG_INDEX=-1
X3_ROLLOUT_MODE=TRANSITIONAL
```

The boundary is the ordered `(blockNumber, logIndex)` immediately before the first eligible aligned-contract package event. Because contract creation contains no package-purchase log, `(deployment block, -1)` is deterministic if no package purchase is accepted before configuration. If that assumption is violated, select the exact last excluded log instead and record its transaction hash. Backend classification is strictly greater than the boundary pair.

Before activation, archive the old address, new address, deployment transaction, deployment block, bytecode hash, verified-source URL, boundary pair, database migration state, and a database snapshot identifier. Confirm all earlier events remain attached to the old contract and no old `X3Placed`/`X3Recycled` event is projected into direct-cycle tables.

The explicit testnet activation command, to be run only after review, is:

```powershell
npm run x3:direct:activate
```

It must be executed with the new aligned address and boundary variables already configured. It must not be run against production during testnet validation.

## End-to-end acceptance

After explicit testnet activation, use fresh wallets and make one serially valid package purchase. Preserve the receipt and verify:

1. One `PackagePurchased` and exactly one `X3DirectSlotFilled` occur in the same receipt.
2. Buyer, owner, package, amount, cycle, slot, recipient, and disposition match permanent referral data.
3. Receipt transaction hash, block number, and log index become the backend lineage.
4. Exactly one direct-cycle slot is stored and a retry creates neither another slot nor another ledger entry.
5. PostgreSQL applies the cap once and creates one 90/10 split (or one timed hold if the recipient is unqualified).
6. Contract X3 processing does not increase X3 recipient `totalEarned`, Income Wallet, or Magic Wallet state.
7. A third direct purchase passes income upward without changing the recipient sponsor's cycle.
8. API and UI show the same cycle, slot, buyer, recipient, and disposition.

Repeat for slots 2 and 3 before calling the design deployment-ready. Test package independence and a second-cycle slot as well.

## Rollback before activation

If any bytecode, source, ABI, role, address, boundary, or dry-run check fails, leave the database in `TRANSITIONAL`, restore the previous testnet contract environment values, and abandon the new address. No direct-cycle financial projection should have occurred, so no financial reversal or historical rewrite is permitted or needed. Investigate and deploy a new immutable contract address; never reuse a mismatched boundary.

Once aligned activation or a package purchase has occurred, address rollback is no longer a simple configuration rollback. Pause further testnet purchases, preserve all receipts and database rows, and perform a reviewed forward migration instead of deleting or reinterpreting records.
