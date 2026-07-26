CREATE TABLE earning_split_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),
 income_credit_ledger_id uuid NOT NULL UNIQUE REFERENCES income_credit_ledger(id),income_type varchar(64) NOT NULL,
 source_reference varchar(200) NOT NULL,gross_calculated numeric(78,0) NOT NULL CHECK(gross_calculated>0),
 capped_gross_credit numeric(78,0) NOT NULL CHECK(capped_gross_credit>=0),capped_excess numeric(78,0) NOT NULL CHECK(capped_excess>=0),
 magic_amount numeric(78,0) NOT NULL CHECK(magic_amount>=0),income_amount numeric(78,0) NOT NULL CHECK(income_amount>=0),
 counts_for_dividend_comparison boolean NOT NULL,idempotency_key varchar(200) NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(gross_calculated=capped_gross_credit+capped_excess),CHECK(capped_gross_credit=magic_amount+income_amount)
);
CREATE TABLE income_wallet_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),split_event_id uuid UNIQUE REFERENCES earning_split_events(id),
 withdrawal_id uuid,direction ledger_direction NOT NULL,amount numeric(78,0) NOT NULL CHECK(amount>0),
 reason varchar(40) NOT NULL CHECK(reason IN('EARNING_NET','WITHDRAWAL_RESERVE','WITHDRAWAL_RELEASE','WITHDRAWAL_DEBIT')),
 idempotency_key varchar(200) NOT NULL UNIQUE,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE magic_funding_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),source_type varchar(48) NOT NULL,
 source_reference varchar(200) NOT NULL UNIQUE,amount numeric(78,0) NOT NULL CHECK(amount>0),
 status varchar(24) NOT NULL CHECK(status IN('PENDING','BROADCASTED','CONFIRMED','MISMATCH','FAILED')),
 magic_wallet_ledger_id uuid UNIQUE REFERENCES magic_wallet_ledger(id),tx_hash varchar(66),onchain_amount numeric(78,0),
 idempotency_key varchar(200) NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'CONFIRMED' OR (magic_wallet_ledger_id IS NOT NULL AND onchain_amount=amount))
);
CREATE TABLE magic_funding_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),funding_event_id uuid NOT NULL UNIQUE REFERENCES magic_funding_events(id),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),next_attempt_at timestamptz NOT NULL DEFAULT now(),
 locked_at timestamptz,last_error varchar(500),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE x4_income_history ADD COLUMN magic_funding_event_id uuid REFERENCES magic_funding_events(id);
DO $$ DECLARE constraint_name text; BEGIN
 SELECT conname INTO constraint_name FROM pg_constraint
 WHERE conrelid='x4_income_history'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%wallet_type%';
 IF constraint_name IS NOT NULL THEN EXECUTE format('ALTER TABLE x4_income_history DROP CONSTRAINT %I',constraint_name); END IF;
END $$;
ALTER TABLE x4_income_history ADD CONSTRAINT x4_income_wallet_reference CHECK (
 (wallet_type='MAGIC_LEVEL' AND income_credit_ledger_id IS NULL AND
   ((magic_wallet_ledger_id IS NOT NULL)::int+(magic_funding_event_id IS NOT NULL)::int)=1)
 OR (wallet_type='EARNING' AND magic_wallet_ledger_id IS NULL AND magic_funding_event_id IS NULL AND income_credit_ledger_id IS NOT NULL)
);
CREATE TABLE magic_balance_reconciliation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),checked_at timestamptz NOT NULL DEFAULT now(),
 database_balance numeric(78,0) NOT NULL,onchain_balance numeric(78,0) NOT NULL,difference numeric(78,0) NOT NULL,
 status varchar(16) NOT NULL CHECK(status IN('MATCH','MISMATCH')),idempotency_key varchar(200) NOT NULL UNIQUE
);
CREATE TABLE magic_distribution_level_outcomes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),distribution_cycle_id uuid NOT NULL REFERENCES distribution_cycles(id),
 source_user_id uuid NOT NULL REFERENCES users(id),level_number smallint NOT NULL CHECK(level_number BETWEEN 1 AND 20),
 classified_amount numeric(78,0) NOT NULL CHECK(classified_amount=50000),
 outcome varchar(24) NOT NULL CHECK(outcome IN('CREDITED','CAPPED','MISSING_UPLINE','UNQUALIFIED','PENDING')),
 credited_amount numeric(78,0) NOT NULL CHECK(credited_amount>=0 AND credited_amount<=50000),
 idempotency_key varchar(200) NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(distribution_cycle_id,source_user_id,level_number)
);
CREATE TABLE x3_hold_release_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),hold_id uuid NOT NULL UNIQUE REFERENCES x3_hold_ledger(id),user_id uuid NOT NULL REFERENCES users(id),
 package_id smallint NOT NULL,release_purchase_id uuid NOT NULL REFERENCES package_purchases(id),gross_amount numeric(78,0) NOT NULL CHECK(gross_amount>0),
 split_event_id uuid NOT NULL UNIQUE REFERENCES earning_split_events(id),idempotency_key varchar(200) NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dividend_repair_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cap_allocation_id uuid REFERENCES daily_dividend_cap_allocations(id),
 finding varchar(40) NOT NULL CHECK(finding IN('NON_DIVIDEND_INCOME','PRE_ACTIVATION','FUTURE_PACKAGE')),
 amount numeric(78,0) NOT NULL CHECK(amount>0),details jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(cap_allocation_id,finding)
);
INSERT INTO dividend_repair_audit(cap_allocation_id,finding,amount,details)
SELECT a.id,'NON_DIVIDEND_INCOME',a.amount,jsonb_build_object('incomeType',e.income_type,'packagePurchaseId',a.package_purchase_id)
FROM daily_dividend_cap_allocations a JOIN daily_dividend_cap_events e ON e.id=a.cap_event_id
WHERE e.income_type<>'DAILY_DIVIDEND' ON CONFLICT DO NOTHING;

CREATE TABLE auto_withdrawals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),payout_address varchar(42) NOT NULL,
 gross_reserved numeric(78,0) NOT NULL CHECK(gross_reserved>0),fee_amount numeric(78,0) NOT NULL CHECK(fee_amount>=0),
 net_payout numeric(78,0) NOT NULL CHECK(net_payout>0),status varchar(24) NOT NULL CHECK(status IN(
 'PENDING','RESERVED','BROADCASTING','BROADCASTED','CONFIRMED','FAILED_RETRYABLE','FAILED_FINAL','REVERSED')),
 tx_hash varchar(66),attempt_count integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 idempotency_key varchar(200) NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(gross_reserved=fee_amount+net_payout),CHECK(tx_hash IS NULL OR status IN('BROADCASTED','CONFIRMED','FAILED_RETRYABLE','FAILED_FINAL'))
);
CREATE UNIQUE INDEX auto_withdraw_one_active_user_idx ON auto_withdrawals(user_id) WHERE status IN('PENDING','RESERVED','BROADCASTING','BROADCASTED','FAILED_RETRYABLE');
ALTER TABLE income_wallet_ledger ADD CONSTRAINT income_wallet_withdrawal_fk FOREIGN KEY(withdrawal_id) REFERENCES auto_withdrawals(id);
CREATE TABLE auto_withdrawal_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),withdrawal_id uuid NOT NULL REFERENCES auto_withdrawals(id),attempt_number integer NOT NULL,
 status varchar(24) NOT NULL,tx_hash varchar(66),error_message varchar(500),idempotency_key varchar(200) NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(withdrawal_id,attempt_number)
);
CREATE TABLE auto_withdrawal_audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),withdrawal_id uuid REFERENCES auto_withdrawals(id),user_id uuid REFERENCES users(id),
 event_type varchar(48) NOT NULL,idempotency_key varchar(200) NOT NULL UNIQUE,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX income_wallet_user_idx ON income_wallet_ledger(user_id,created_at);
CREATE INDEX magic_funding_status_idx ON magic_funding_events(status,created_at);
CREATE INDEX magic_outbox_due_idx ON magic_funding_outbox(next_attempt_at);
CREATE INDEX auto_withdraw_due_idx ON auto_withdrawals(status,next_attempt_at);
CREATE TRIGGER earning_split_append_only BEFORE UPDATE OR DELETE ON earning_split_events FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER income_wallet_append_only BEFORE UPDATE OR DELETE ON income_wallet_ledger FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER magic_reconciliation_append_only BEFORE UPDATE OR DELETE ON magic_balance_reconciliation FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER magic_outcomes_append_only BEFORE UPDATE OR DELETE ON magic_distribution_level_outcomes FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER x3_release_history_append_only BEFORE UPDATE OR DELETE ON x3_hold_release_history FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER dividend_repair_audit_append_only BEFORE UPDATE OR DELETE ON dividend_repair_audit FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER withdrawal_attempts_append_only BEFORE UPDATE OR DELETE ON auto_withdrawal_attempts FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER withdrawal_audit_append_only BEFORE UPDATE OR DELETE ON auto_withdrawal_audit_logs FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
