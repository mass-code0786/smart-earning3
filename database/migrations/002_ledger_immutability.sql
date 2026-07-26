CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER magic_wallet_ledger_append_only
BEFORE UPDATE OR DELETE ON magic_wallet_ledger
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TRIGGER direct_income_ledger_append_only
BEFORE UPDATE OR DELETE ON direct_income_ledger
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TRIGGER magic_income_ledger_append_only
BEFORE UPDATE OR DELETE ON magic_income_ledger
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TRIGGER referral_relations_immutable
BEFORE UPDATE OR DELETE ON referral_relations
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TRIGGER matrix_placements_immutable
BEFORE UPDATE OR DELETE ON matrix_placements
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
