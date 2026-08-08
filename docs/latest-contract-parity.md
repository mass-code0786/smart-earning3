# Latest contract parity

The runtime bytecode and constructor state are anchored by `deployments/bsc-testnet.json`.
Every event below is decoded by the receipt indexer. `UserRegistered` and
`PackagePurchased` invoke domain projections; every other event is retained in
`contract_events` for audit/recovery, while the named service owns its domain ledger.

| Contract event | Domain projection | Consumer / status |
|---|---|---|
| UserRegistered | registration, referral, binary placement, cap and income ledgers | login, dashboard, team, history |
| RegistrationCompleted | generic contract event | payment audit; no separate balance |
| PackagePurchased | package, cap, X3, X4, Booster, Dividend and Magic ledgers | package/module APIs and UI |
| X3DirectSlotFilled | generic event plus receipt-validated direct-X3 projection from PackagePurchased | X3 API/UI/history |
| X3DirectCycleCompleted | generic event; direct-X3 cycle projection | X3 API/UI/history |
| X4Placed | generic event plus receipt-validated X4 projection | X4 API/UI/history |
| X4Recycled | generic event plus receipt-validated X4 recycle projection | X4 API/UI/history |
| MagicDistributed | generic event; distribution worker cycle | Magic reports |
| MagicLevelAllocated | generic event; distribution worker level ledger | Magic reports/history |
| MagicIncomeClaimed | generic contract event | unused: current withdrawals use unified income wallet |
| MagicFunded | generic event; Magic funding outbox ledger | operations/reconciliation |
| MagicFundingRecorded | generic event; package/X4/registration receipt evidence | Magic ledger/history |
| EarningSplit | generic event; confirmed on-chain split is mirrored by canonical earning service | income/history |
| EarningCapIncreased | generic event; PackagePurchased is canonical cap projection | package/admin reports |
| IncomeCapped | generic event; canonical cap/excess ledgers | package/admin/history |
| PaymentReceived | generic event | treasury payment audit |
| TreasuryFunded | generic event; Booster verification evidence | operations/Booster audit |
| BoosterTopup | generic event; Booster receipt projection | Booster API/UI |
| WithdrawalLiquidityFunded | generic event | treasury/liquidity operations |
| WithdrawalPaid | generic event; withdrawal broadcaster receipt reconciliation | wallet/withdrawal UI |
| TreasuryWalletUpdated | generic event | operations audit; runtime reads current contract value |
| PaymentPauseChanged | generic event | operations audit; runtime reads current contract value |
| WithdrawalPauseChanged | generic event | operations audit; runtime reads current contract value |
| PlacementCursorAdvanced | generic event; placement preparation attempt ledger | registration recovery |
| Paused / Unpaused | generic events | operations audit |
| RoleGranted / RoleRevoked / RoleAdminChanged | generic events | role/security audit |

## On-chain boundaries

| Module | On-chain authority | Server authority |
|---|---|---|
| Registration | payment, sponsor existence, binary placement, direct cap/split, $1 Magic | indexed ownership/referral/history ledgers |
| Packages | serial ladder, payment, 5x cap, X3/X4 facts, 12.5% Magic | reporting and downstream module projections |
| X3 | direct-cycle slot/order events only | qualification, hold/expiry and financial ledgers |
| X4 | FIFO placement/recycle and financial/Magic accounting | receipt-validated reporting ledgers; never re-funds on-chain credit |
| Magic level | balance, 20-level qualification, cap/split and allocation events | scheduler, idempotent distribution/history ledgers |
| Booster | top-up payment/treasury event | eligibility, queue, scheduler, payout and cap ledger |
| Autopool | none | synchronous Booster-derived global queue, payout and cap ledger |
| Dividend | none | daily package qualification, attribution, settlement and cap ledger |
| Withdrawals | liquidity and signed payout execution | income-wallet reservation, authorization request, retry and receipt reconciliation |
