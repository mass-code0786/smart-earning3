CREATE TABLE daily_dividend_income_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES daily_dividend_settlements(id),
  income_credit_ledger_id uuid NOT NULL REFERENCES income_credit_ledger(id),
  package_purchase_id uuid NOT NULL REFERENCES package_purchases(id),
  user_id uuid NOT NULL REFERENCES users(id),
  business_date date NOT NULL,
  income_occurred_at timestamptz NOT NULL,
  applicable_start timestamptz NOT NULL,
  applicable_end timestamptz NOT NULL,
  amount numeric(78,0) NOT NULL CHECK(amount>0),
  idempotency_key varchar(200) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(settlement_id,income_credit_ledger_id,package_purchase_id),
  CHECK(income_occurred_at>=applicable_start AND income_occurred_at<applicable_end)
);
CREATE INDEX dividend_income_attribution_package_idx ON daily_dividend_income_attributions(package_purchase_id,business_date);
CREATE INDEX dividend_income_attribution_event_idx ON daily_dividend_income_attributions(income_credit_ledger_id);
CREATE FUNCTION validate_dividend_income_attribution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_credit numeric(78,0); attributed numeric(78,0);
BEGIN
  SELECT credited_amount INTO event_credit FROM income_credit_ledger WHERE id=NEW.income_credit_ledger_id;
  SELECT COALESCE(sum(amount),0) INTO attributed FROM daily_dividend_income_attributions
    WHERE settlement_id=NEW.settlement_id AND income_credit_ledger_id=NEW.income_credit_ledger_id;
  IF attributed+NEW.amount>event_credit THEN RAISE EXCEPTION 'Dividend income attribution exceeds source event credit'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dividend_income_attribution_limit BEFORE INSERT ON daily_dividend_income_attributions
  FOR EACH ROW EXECUTE FUNCTION validate_dividend_income_attribution();
CREATE TRIGGER dividend_income_attribution_append_only BEFORE UPDATE OR DELETE ON daily_dividend_income_attributions
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
