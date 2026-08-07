-- Reconcile the persisted cap projection to confirmed post-registration packages only.
-- Historical income and immutable cap ledger rows remain untouched for auditability.
CREATE TABLE IF NOT EXISTS earning_cap_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  policy_version varchar(64) NOT NULL,
  old_eligible_value numeric(78,0) NOT NULL,
  new_eligible_value numeric(78,0) NOT NULL,
  old_earning_cap numeric(78,0) NOT NULL,
  new_earning_cap numeric(78,0) NOT NULL,
  total_earned_at_reconciliation numeric(78,0) NOT NULL,
  historical_excess numeric(78,0) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT earning_cap_reconciliation_once UNIQUE(user_id,policy_version)
);

WITH corrected AS (
  SELECT s.user_id,
    COALESCE(sum(p.amount_token_units) FILTER (WHERE p.status='CONFIRMED'),0) package_principal,
    s.total_eligible_value old_eligible_value,
    s.total_earning_cap old_earning_cap,
    s.total_earned
  FROM user_package_states s
  LEFT JOIN package_purchases p ON p.user_id=s.user_id
  GROUP BY s.user_id,s.total_eligible_value,s.total_earning_cap,s.total_earned
), audited AS (
  INSERT INTO earning_cap_reconciliations(
    user_id,policy_version,old_eligible_value,new_eligible_value,
    old_earning_cap,new_earning_cap,total_earned_at_reconciliation,historical_excess
  )
  SELECT user_id,'PACKAGE_ONLY_5X_V1',old_eligible_value,package_principal,
    old_earning_cap,package_principal*5,total_earned,
    GREATEST(total_earned-package_principal*5,0)
  FROM corrected
  ON CONFLICT(user_id,policy_version) DO NOTHING
  RETURNING user_id
)
UPDATE user_package_states s
SET total_eligible_value=c.package_principal,
    total_package_value=c.package_principal,
    total_earning_cap=c.package_principal*5,
    remaining_cap=GREATEST(c.package_principal*5-s.total_earned,0),
    capping_status=CASE
      WHEN s.total_earned>=c.package_principal*5 THEN 'CAPPED'
      WHEN s.total_earned*100>=c.package_principal*5*90 THEN 'NEAR_CAP'
      ELSE 'ACTIVE'
    END,
    updated_at=now()
FROM corrected c
JOIN audited a ON a.user_id=c.user_id
WHERE s.user_id=c.user_id;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='earning_cap_reconciliations_append_only'
      AND tgrelid='earning_cap_reconciliations'::regclass
  ) THEN
    CREATE TRIGGER earning_cap_reconciliations_append_only
    BEFORE UPDATE OR DELETE ON earning_cap_reconciliations
    FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
  END IF;
END $$;
