ALTER TABLE package_definitions ADD COLUMN dividend_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE daily_dividend_package_status (
  package_purchase_id uuid PRIMARY KEY REFERENCES package_purchases(id),
  user_id uuid NOT NULL REFERENCES users(id),
  principal_amount numeric(78,0) NOT NULL CHECK(principal_amount>=8000000),
  daily_target numeric(78,0) NOT NULL CHECK(daily_target=principal_amount/100),
  cap_amount numeric(78,0) NOT NULL CHECK(cap_amount=principal_amount*2),
  counted_income numeric(78,0) NOT NULL DEFAULT 0 CHECK(counted_income>=0 AND counted_income<=cap_amount),
  remaining_cap numeric(78,0) NOT NULL CHECK(remaining_cap=cap_amount-counted_income),
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','CAPPED')),
  activated_at timestamptz NOT NULL,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((status='CAPPED')=(completed_at IS NOT NULL)),
  CHECK(status<>'CAPPED' OR remaining_cap=0)
);

CREATE TABLE daily_dividend_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  business_date date NOT NULL, timezone varchar(80) NOT NULL, status varchar(20) NOT NULL CHECK(status IN('COMPLETED','ZERO','FAILED')),
  total_daily_target numeric(78,0) NOT NULL CHECK(total_daily_target>=0), other_counted_income numeric(78,0) NOT NULL CHECK(other_counted_income>=0),
  calculated_shortfall numeric(78,0) NOT NULL CHECK(calculated_shortfall>=0), credited_amount numeric(78,0) NOT NULL CHECK(credited_amount>=0),
  error_code varchar(80), error_message varchar(500), idempotency_key varchar(200) NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,business_date), CHECK(credited_amount<=calculated_shortfall)
);

CREATE TABLE daily_dividend_cap_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),income_credit_ledger_id uuid NOT NULL UNIQUE REFERENCES income_credit_ledger(id),
 income_type varchar(64) NOT NULL,credited_amount numeric(78,0) NOT NULL CHECK(credited_amount>0),attributed_amount numeric(78,0) NOT NULL CHECK(attributed_amount>=0),
 unattributed_excess numeric(78,0) NOT NULL CHECK(unattributed_excess>=0),created_at timestamptz NOT NULL DEFAULT now(),CHECK(credited_amount=attributed_amount+unattributed_excess)
);

CREATE TABLE daily_dividend_cap_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cap_event_id uuid NOT NULL REFERENCES daily_dividend_cap_events(id),package_purchase_id uuid NOT NULL REFERENCES package_purchases(id),
 amount numeric(78,0) NOT NULL CHECK(amount>0),remaining_cap_before numeric(78,0) NOT NULL CHECK(remaining_cap_before>=amount),remaining_cap_after numeric(78,0) NOT NULL,
 idempotency_key varchar(200) NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(cap_event_id,package_purchase_id),
 CHECK(remaining_cap_after=remaining_cap_before-amount)
);

CREATE TABLE daily_dividend_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),settlement_id uuid NOT NULL REFERENCES daily_dividend_settlements(id),package_purchase_id uuid NOT NULL REFERENCES package_purchases(id),
 user_id uuid NOT NULL REFERENCES users(id),business_date date NOT NULL,amount numeric(78,0) NOT NULL CHECK(amount>0),daily_target numeric(78,0) NOT NULL CHECK(daily_target>0),
 other_income_considered numeric(78,0) NOT NULL CHECK(other_income_considered>=0),remaining_cap_before numeric(78,0) NOT NULL CHECK(remaining_cap_before>=amount),
 remaining_cap_after numeric(78,0) NOT NULL,income_credit_ledger_id uuid NOT NULL UNIQUE REFERENCES income_credit_ledger(id),idempotency_key varchar(200) NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(settlement_id,package_purchase_id),CHECK(remaining_cap_after=remaining_cap_before-amount)
);

CREATE TABLE daily_dividend_scheduler_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_date date NOT NULL,status varchar(20) NOT NULL CHECK(status IN('COMPLETED','SKIPPED','FAILED')),
 worker_instance varchar(100) NOT NULL,users_processed integer NOT NULL DEFAULT 0 CHECK(users_processed>=0),error_message varchar(500),
 idempotency_key varchar(200) NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE daily_dividend_audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_type varchar(48) NOT NULL,user_id uuid REFERENCES users(id),settlement_id uuid REFERENCES daily_dividend_settlements(id),
 package_purchase_id uuid REFERENCES package_purchases(id),idempotency_key varchar(200) NOT NULL UNIQUE,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dividend_package_user_idx ON daily_dividend_package_status(user_id,status,activated_at);
CREATE INDEX dividend_settlement_date_idx ON daily_dividend_settlements(business_date,status);
CREATE INDEX dividend_allocation_user_idx ON daily_dividend_allocations(user_id,business_date);
CREATE INDEX dividend_scheduler_date_idx ON daily_dividend_scheduler_history(business_date,created_at DESC);
CREATE INDEX dividend_audit_created_idx ON daily_dividend_audit_logs(created_at DESC);
CREATE TRIGGER dividend_settlements_no_delete BEFORE DELETE ON daily_dividend_settlements FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER dividend_cap_events_append_only BEFORE UPDATE OR DELETE ON daily_dividend_cap_events FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER dividend_cap_allocations_append_only BEFORE UPDATE OR DELETE ON daily_dividend_cap_allocations FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER dividend_allocations_append_only BEFORE UPDATE OR DELETE ON daily_dividend_allocations FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER dividend_scheduler_append_only BEFORE UPDATE OR DELETE ON daily_dividend_scheduler_history FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER dividend_audit_append_only BEFORE UPDATE OR DELETE ON daily_dividend_audit_logs FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

INSERT INTO daily_dividend_package_status(package_purchase_id,user_id,principal_amount,daily_target,cap_amount,remaining_cap,activated_at)
SELECT p.id,p.user_id,p.amount_token_units,p.amount_token_units/100,p.amount_token_units*2,p.amount_token_units*2,p.purchased_at
FROM package_purchases p JOIN package_definitions d ON d.id=p.package_definition_id
WHERE p.status='CONFIRMED' AND p.amount_token_units>=8000000 AND d.dividend_enabled AND p.purchased_at IS NOT NULL
ON CONFLICT(package_purchase_id) DO NOTHING;
