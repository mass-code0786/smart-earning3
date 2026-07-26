DROP TRIGGER IF EXISTS x3_cycle_slots_append_only ON x3_cycle_slots;
DROP TRIGGER IF EXISTS x3_placement_events_append_only ON x3_placement_events;

ALTER TABLE x3_cycle_slots
  ADD COLUMN original_package_purchase_id uuid REFERENCES package_purchases(id),
  ADD COLUMN source_contract_event_id uuid REFERENCES contract_events(id),
  ADD COLUMN original_allocation_amount numeric(78,0),
  ADD COLUMN carried_allocation_amount numeric(78,0),
  ADD COLUMN recycle_depth integer NOT NULL DEFAULT 0 CHECK(recycle_depth >= 0),
  ADD COLUMN previous_recycle_event_id uuid REFERENCES x3_recycle_events(id);

UPDATE x3_cycle_slots s
SET original_package_purchase_id=s.placed_user_purchase_id,
    source_contract_event_id=(SELECT e.id FROM contract_events e
      WHERE e.tx_hash=p.tx_hash AND e.event_name='PackagePurchased' ORDER BY e.log_index LIMIT 1),
    original_allocation_amount=CASE WHEN s.x3_allocation_amount>0 THEN s.x3_allocation_amount ELSE p.amount_token_units/4 END,
    carried_allocation_amount=CASE WHEN s.x3_allocation_amount>0 THEN s.x3_allocation_amount ELSE p.amount_token_units/4 END
FROM package_purchases p
WHERE p.id=s.placed_user_purchase_id AND s.original_allocation_amount IS NULL;

ALTER TABLE x3_cycle_slots
  ALTER COLUMN original_package_purchase_id SET NOT NULL,
  ALTER COLUMN original_allocation_amount SET NOT NULL,
  ALTER COLUMN carried_allocation_amount SET NOT NULL,
  ADD CONSTRAINT x3_slot_allocation_positive CHECK(carried_allocation_amount > 0),
  ADD CONSTRAINT x3_slot_allocation_conserved CHECK(
    carried_allocation_amount=original_allocation_amount
  );

ALTER TABLE x3_placement_events
  ADD COLUMN source_package_purchase_id uuid REFERENCES package_purchases(id),
  ADD COLUMN source_contract_event_id uuid REFERENCES contract_events(id),
  ADD COLUMN original_allocation_amount numeric(78,0),
  ADD COLUMN carried_allocation_amount numeric(78,0),
  ADD COLUMN recycle_depth integer NOT NULL DEFAULT 0 CHECK(recycle_depth >= 0),
  ADD COLUMN previous_recycle_event_id uuid REFERENCES x3_recycle_events(id);

UPDATE x3_placement_events e
SET source_package_purchase_id=s.placed_user_purchase_id,
    source_contract_event_id=s.source_contract_event_id,
    original_allocation_amount=s.original_allocation_amount,
    carried_allocation_amount=s.carried_allocation_amount
FROM x3_cycle_slots s
WHERE s.placed_user_cycle_id=e.cycle_id AND e.original_allocation_amount IS NULL;

ALTER TABLE x3_placement_events
  ALTER COLUMN source_package_purchase_id SET NOT NULL,
  ALTER COLUMN original_allocation_amount SET NOT NULL,
  ALTER COLUMN carried_allocation_amount SET NOT NULL,
  ADD CONSTRAINT x3_placement_allocation_positive CHECK(carried_allocation_amount > 0),
  ADD CONSTRAINT x3_placement_allocation_conserved CHECK(
    carried_allocation_amount=original_allocation_amount
  );

ALTER TABLE x3_recycle_events
  ADD COLUMN source_package_purchase_id uuid REFERENCES package_purchases(id),
  ADD COLUMN source_contract_event_id uuid REFERENCES contract_events(id),
  ADD COLUMN original_allocation_amount numeric(78,0),
  ADD COLUMN carried_allocation_amount numeric(78,0),
  ADD COLUMN recycle_depth integer NOT NULL DEFAULT 0 CHECK(recycle_depth >= 0),
  ADD COLUMN previous_recycle_event_id uuid REFERENCES x3_recycle_events(id),
  ADD COLUMN resulting_placement_id uuid REFERENCES x3_placement_events(id),
  ADD COLUMN terminal_income_id uuid REFERENCES x3_income_ledger(id),
  ADD COLUMN terminal_pending_id uuid;

CREATE TABLE x3_pending_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id smallint NOT NULL CHECK(package_id BETWEEN 1 AND 8),
  source_package_purchase_id uuid NOT NULL REFERENCES package_purchases(id),
  source_contract_event_id uuid REFERENCES contract_events(id),
  original_allocation_amount numeric(78,0) NOT NULL CHECK(original_allocation_amount > 0),
  carried_allocation_amount numeric(78,0) NOT NULL CHECK(carried_allocation_amount > 0),
  completed_cycle_id uuid NOT NULL REFERENCES x3_cycles(id),
  recycle_chain jsonb NOT NULL DEFAULT '[]'::jsonb,
  root_user_id uuid REFERENCES users(id),
  status varchar(24) NOT NULL CHECK(status IN ('ROOT_PENDING','RECYCLE_PENDING')),
  reason varchar(160) NOT NULL,
  recycle_depth integer NOT NULL CHECK(recycle_depth >= 0),
  previous_recycle_event_id uuid REFERENCES x3_recycle_events(id),
  idempotency_key varchar(200) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK(original_allocation_amount=carried_allocation_amount)
);
ALTER TABLE x3_recycle_events
  ADD CONSTRAINT x3_recycle_terminal_pending_fk
  FOREIGN KEY(terminal_pending_id) REFERENCES x3_pending_allocations(id);
CREATE INDEX x3_pending_package_status_idx ON x3_pending_allocations(package_id,status,created_at);

CREATE TRIGGER x3_pending_allocations_append_only
BEFORE UPDATE OR DELETE ON x3_pending_allocations
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

DROP TRIGGER IF EXISTS x3_recycle_events_append_only ON x3_recycle_events;
CREATE OR REPLACE FUNCTION finalize_x3_recycle_event() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'x3_recycle_events is append-only'; END IF;
  IF OLD.resulting_placement_id IS NULL
     AND OLD.terminal_income_id IS NULL
     AND OLD.terminal_pending_id IS NULL
     AND (NEW.resulting_placement_id IS NOT NULL
       OR NEW.terminal_income_id IS NOT NULL
       OR NEW.terminal_pending_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'finalized X3 recycle event is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER x3_recycle_events_finalize_once
BEFORE UPDATE OR DELETE ON x3_recycle_events
FOR EACH ROW EXECUTE FUNCTION finalize_x3_recycle_event();

CREATE TRIGGER x3_cycle_slots_append_only BEFORE UPDATE OR DELETE ON x3_cycle_slots
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
CREATE TRIGGER x3_placement_events_append_only BEFORE UPDATE OR DELETE ON x3_placement_events
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
