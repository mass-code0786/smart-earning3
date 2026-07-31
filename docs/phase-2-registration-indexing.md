# Phase 2 registration indexing

## Before

The browser called `register(sponsor)`, waited for one mined receipt, then made one
`POST /api/registrations/verify` request. A `CONFIRMATIONS_PENDING` response was
shown as a registration failure. Both that API and the live receipt indexer called
`verifyAndActivateRegistration`, which decoded `UserRegistered` and transactionally
created the registration projection. The live indexer ran inside the single PM2
Next.js process through `instrumentation.ts`; a fresh checkpoint was intended to
use the deployment block, but deployment identity came from independent environment
variables. Existing late checkpoints had only wallet-specific diagnostics and no
bounded historical repair.

## Contract source of truth

`UserRegistered` emits, in order:

1. `address indexed user`
2. `address indexed sponsor`
3. `address indexed matrixParent`
4. `uint256 matrixIndex`
5. `uint8 matrixPosition`
6. `uint256 directSponsorIncome`
7. `uint256 magicWalletCredit`

Thus it directly contains the registered wallet, sponsor, exact binary parent,
matrix index and position, direct income, and magic allocation. It does not contain
the registration amount. The amount is available from the same transaction's
`RegistrationCompleted` event and the immutable `registrationPrice()` state.

The canonical binary placement is the `matrixParent`, `matrixIndex`, and
`matrixPosition` tuple emitted by `UserRegistered`, corroborated by
`matrixParentOf(user)` and `matrixIndexOf(user)`. Sponsor and matrix parent are
different concepts. The database never runs an independent placement algorithm.

Genesis is constructor state and emits no `UserRegistered`. The tracked deployment
metadata supplies its wallet, and bootstrap reads `registrationPrice()` from the
deployed contract before idempotently creating the root projection.

## After

Tracked `deployments/bsc-testnet.json` is the authoritative chain, address,
deployment transaction, deployment block, and genesis identity. Startup rejects
missing/invalid metadata and any conflicting environment value. A new checkpoint
is always deployment block minus one.

Registration events are processed in block, transaction, and log order. Temporary
dependency failures abort the block and leave both event and checkpoint retryable.
Idempotent events are harmless. Hard projection conflicts are recorded with the
expected on-chain tuple and actual database rows, then exposed through readiness.
Matrix rows retain sponsor and full event provenance.

`npm run repair:registration-index` is dry-run by default. It accepts
`--from-block=N` and `--to-block=N`; mutation additionally requires `--apply`.
It uses a PostgreSQL advisory lock, invokes the same transactional idempotent
projector, and prints exact before/after reports.

The browser polls pending verification with bounded exponential backoff. Timeout
means pending synchronization, preserves the transaction hash, and can be retried.

## Runtime ownership

Production has one declared PM2 application (`smart-earning`, one fork instance).
Next.js `instrumentation.ts` owns the embedded indexer. A session-level PostgreSQL
advisory lock prevents another web process or the standalone diagnostic entrypoint
from concurrently owning live indexing. Startup logs chain ID, contract, deployment
block, checkpoint, safe head, and lock state. Readiness requires a running owner,
reachable RPC, matching chain, deployed contract code, checkpoint lag within
`BLOCKCHAIN_INDEXER_MAX_BLOCKS_BEHIND` (default 20), and zero unresolved registration
projection conflicts.
