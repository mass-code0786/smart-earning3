# Database

PostgreSQL is the source of truth for indexed chain state and reporting. Ledgers,
referrals, and matrix placements are append-only. Run migrations in numeric order:

```powershell
$env:DATABASE_URL='postgresql://...'
npm run migrate
```

Amounts are stored as integer token units in `numeric(78,0)`. The application
discovers USDT decimals from the configured token contract and never stores
floating-point monetary values.
