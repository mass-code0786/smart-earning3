CREATE TABLE treasury_payment_reconciliation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),chain_id integer NOT NULL,transaction_hash varchar(66) NOT NULL,
 source_reference varchar(66) NOT NULL,payment_type varchar(48) NOT NULL,user_address varchar(42) NOT NULL,
 gross_amount numeric(78,0) NOT NULL CHECK(gross_amount>0),treasury_amount numeric(78,0) NOT NULL CHECK(treasury_amount>=0),
 state_recorded boolean NOT NULL,classification varchar(48) NOT NULL CHECK(classification IN(
 'MATCH','PAYMENT_RECEIVED_NOT_FORWARDED','TREASURY_FORWARD_AMOUNT_MISMATCH',
 'PACKAGE_STATE_WITHOUT_PAYMENT','PAYMENT_WITHOUT_PACKAGE_STATE')),
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(chain_id,transaction_hash,source_reference)
);
CREATE TABLE withdrawal_liquidity_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_reference varchar(66) NOT NULL UNIQUE,
 amount numeric(78,0) NOT NULL CHECK(amount>0),transaction_hash varchar(66) UNIQUE,
 status varchar(24) NOT NULL CHECK(status IN('PENDING','SUBMITTED','CONFIRMED','FAILED','MISMATCH')),
 funded_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE withdrawal_liquidity_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),liquidity_event_id uuid NOT NULL REFERENCES withdrawal_liquidity_events(id),
 withdrawal_id uuid NOT NULL UNIQUE REFERENCES auto_withdrawals(id),net_amount numeric(78,0) NOT NULL CHECK(net_amount>0),
 idempotency_key varchar(200) NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE withdrawal_chain_reconciliation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),withdrawal_id uuid NOT NULL REFERENCES auto_withdrawals(id),
 classification varchar(48) NOT NULL CHECK(classification IN(
 'MATCH','TREASURY_LIQUIDITY_NOT_RECORDED','WITHDRAWAL_FUNDED_NOT_PAID',
 'WITHDRAWAL_PAID_DATABASE_PENDING','DATABASE_CONFIRMED_CHAIN_MISSING','CONTRACT_UNEXPECTED_BALANCE')),
 database_gross numeric(78,0) NOT NULL,database_fee numeric(78,0) NOT NULL,database_net numeric(78,0) NOT NULL,
 chain_paid_amount numeric(78,0),transaction_hash varchar(66),metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 idempotency_key varchar(200) NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX treasury_payment_classification_idx ON treasury_payment_reconciliation(classification,created_at DESC);
CREATE INDEX withdrawal_liquidity_status_idx ON withdrawal_liquidity_events(status,created_at);
CREATE INDEX withdrawal_chain_classification_idx ON withdrawal_chain_reconciliation(classification,created_at DESC);
CREATE TRIGGER treasury_payment_reconciliation_append_only BEFORE UPDATE OR DELETE ON treasury_payment_reconciliation FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER withdrawal_liquidity_allocations_append_only BEFORE UPDATE OR DELETE ON withdrawal_liquidity_allocations FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER withdrawal_chain_reconciliation_append_only BEFORE UPDATE OR DELETE ON withdrawal_chain_reconciliation FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
