# SmartEarning payout authorization

Financial calculations for Dividend, Booster, Autopool, and other ledger-based
income remain off-chain. The on-chain payout security boundary is an immutable
EIP-712 `WithdrawalAuthorization` signed by an account with `AUTHORIZER_ROLE`.

The transaction executor has `WITHDRAWAL_EXECUTOR_ROLE`. The contract prevents
an account from holding both roles. An executor cannot change the destination,
user, payout type, earning source, amounts, domain, nonce, or validity window
without invalidating the signature.

Domain:

- name: `SmartEarning`
- version: `1`
- chainId: current deployment chain
- verifyingContract: deployed `SmartEarning` address

Typed payload:

```text
WithdrawalAuthorization(
  bytes32 payoutType,
  bytes32 reservationId,
  bytes32 earningSource,
  address user,
  uint256 chainId,
  address verifyingContract,
  uint256 grossAmount,
  uint256 feeAmount,
  uint256 netAmount,
  address destination,
  uint256 issuedAt,
  uint256 nonce,
  uint256 deadline
)
```

The canonical reservation hash is the EIP-712 digest:

```text
keccak256(0x1901 || domainSeparator || keccak256(abi.encode(TYPEHASH, fields...)))
```

The digest is stored in `processedWithdrawals` before token transfer. A
successful reservation can therefore never be consumed twice.

Production deployment must use the configured official USDT contract. Incoming
transfers are balance-delta checked, and the supported USDT must not charge
transfer fees, rebase balances, or invoke token callbacks.
