-- Durable, append-only history read model.
-- Rollback: disable the activity_history_* triggers first. Preserve
-- activity_history for audit/export; do not drop it automatically.
CREATE TABLE IF NOT EXISTS activity_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_wallet varchar(42) NOT NULL,
  user_id uuid REFERENCES users(id),
  category varchar(40) NOT NULL CHECK(category IN(
    'PACKAGE','BOOSTER','BOOSTER_INCOME','DIRECT_REFERRAL','DIRECT_INCOME',
    'MAGIC_LEVEL_INCOME','X3_INCOME','X3_RECYCLE','AUTOPOOL','DIVIDEND',
    'WITHDRAWAL','WALLET','TEAM_PACKAGE_ACTIVITY'
  )),
  event_type varchar(80) NOT NULL CHECK(upper(event_type) NOT LIKE '%X4%'),
  title varchar(160) NOT NULL,
  description text,
  amount numeric(38,18),
  currency varchar(16) NOT NULL DEFAULT 'USDT',
  direction varchar(8) CHECK(direction IN('CREDIT','DEBIT','INFO')),
  source_wallet varchar(42),
  source_user_id uuid REFERENCES users(id),
  sponsor_wallet varchar(42),
  referral_level integer,
  package_number integer,
  package_amount numeric(38,18),
  matrix_type varchar(24),
  matrix_package_number integer,
  cycle_number integer,
  recycle_number integer,
  position_number integer,
  previous_balance numeric(38,18),
  new_balance numeric(38,18),
  fee_amount numeric(38,18),
  net_amount numeric(38,18),
  status varchar(32) NOT NULL,
  tx_hash varchar(66),
  block_number bigint,
  log_index integer,
  source_table varchar(80),
  source_record_id varchar(160),
  idempotency_key varchar(300) NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_history_user_wallet_lower CHECK(user_wallet=lower(user_wallet)),
  CONSTRAINT activity_history_source_wallet_lower CHECK(source_wallet IS NULL OR source_wallet=lower(source_wallet)),
  CONSTRAINT activity_history_sponsor_wallet_lower CHECK(sponsor_wallet IS NULL OR sponsor_wallet=lower(sponsor_wallet))
);

ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS user_wallet varchar(42);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS category varchar(40);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS event_type varchar(80);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS title varchar(160);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS status varchar(32);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS idempotency_key varchar(300);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS amount numeric(38,18);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS currency varchar(16) DEFAULT 'USDT';
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS direction varchar(8);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS source_wallet varchar(42);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS source_user_id uuid REFERENCES users(id);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS sponsor_wallet varchar(42);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS referral_level integer;
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS package_number integer;
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS package_amount numeric(38,18);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS matrix_type varchar(24);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS matrix_package_number integer;
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS cycle_number integer;
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS recycle_number integer;
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS position_number integer;
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS previous_balance numeric(38,18);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS new_balance numeric(38,18);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS fee_amount numeric(38,18);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS net_amount numeric(38,18);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS tx_hash varchar(66);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS block_number bigint;
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS log_index integer;
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS source_table varchar(80);
ALTER TABLE activity_history ADD COLUMN IF NOT EXISTS source_record_id varchar(160);

CREATE INDEX IF NOT EXISTS activity_history_wallet_occurred_idx ON activity_history(lower(user_wallet),occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS activity_history_category_occurred_idx ON activity_history(category,occurred_at DESC);
CREATE INDEX IF NOT EXISTS activity_history_event_occurred_idx ON activity_history(event_type,occurred_at DESC);
CREATE INDEX IF NOT EXISTS activity_history_source_wallet_idx ON activity_history(lower(source_wallet)) WHERE source_wallet IS NOT NULL;
CREATE INDEX IF NOT EXISTS activity_history_tx_hash_idx ON activity_history(tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS activity_history_package_idx ON activity_history(package_number) WHERE package_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS activity_history_status_idx ON activity_history(status);
CREATE INDEX IF NOT EXISTS activity_history_source_record_idx ON activity_history(source_record_id);
CREATE INDEX IF NOT EXISTS activity_history_created_idx ON activity_history(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS activity_history_idempotency_key_idx ON activity_history(idempotency_key);

DROP TRIGGER IF EXISTS activity_history_append_only ON activity_history;
CREATE TRIGGER activity_history_append_only
BEFORE UPDATE OR DELETE ON activity_history
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE OR REPLACE FUNCTION write_activity_history_from_source()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner_wallet varchar(42);
  source_user_wallet varchar(42);
  sponsor_user_wallet varchar(42);
  package_price numeric(38,18);
  cycle_no integer;
  slot_no integer;
  previous_units numeric;
  current_units numeric;
  registration_row registrations%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='package_purchases' THEN
    IF NEW.status<>'CONFIRMED' OR (TG_OP='UPDATE' AND OLD.status=NEW.status) THEN RETURN NEW; END IF;
    SELECT wallet_address INTO owner_wallet FROM users WHERE id=NEW.user_id;
    SELECT price_token_units/1000000.0 INTO package_price FROM package_definitions WHERE id=NEW.package_definition_id;
    INSERT INTO activity_history(user_wallet,user_id,category,event_type,title,description,amount,direction,
      package_number,package_amount,status,tx_hash,block_number,source_table,source_record_id,idempotency_key,
      metadata,occurred_at)
    VALUES(owner_wallet,NEW.user_id,'PACKAGE',CASE WHEN NEW.package_id=1 THEN 'PACKAGE_PURCHASED' ELSE 'PACKAGE_UPGRADED' END,
      CASE WHEN NEW.package_id=1 THEN 'Package purchased' ELSE 'Package upgraded' END,
      'Package '||NEW.package_id||' confirmed',NEW.amount_token_units/1000000.0,'DEBIT',NEW.package_id,package_price,
      NEW.status,lower(NEW.tx_hash),NEW.block_number,'package_purchases',NEW.id::text,
      'package_purchases:'||NEW.id||':'||CASE WHEN NEW.package_id=1 THEN 'PACKAGE_PURCHASED' ELSE 'PACKAGE_UPGRADED' END||':'||owner_wallet,
      jsonb_build_object('previousPackage',GREATEST(NEW.package_id-1,0),'newPackage',NEW.package_id),COALESCE(NEW.purchased_at,NEW.created_at))
    ON CONFLICT(idempotency_key) DO NOTHING;
    SELECT u.wallet_address INTO sponsor_user_wallet FROM referral_relations rr JOIN users u ON u.id=rr.sponsor_user_id
      WHERE rr.user_id=NEW.user_id;
    IF sponsor_user_wallet IS NOT NULL THEN
      INSERT INTO activity_history(user_wallet,category,event_type,title,direction,source_wallet,source_user_id,
        sponsor_wallet,referral_level,package_number,package_amount,status,tx_hash,source_table,source_record_id,
        idempotency_key,occurred_at)
      VALUES(sponsor_user_wallet,'TEAM_PACKAGE_ACTIVITY','TEAM_PACKAGE_CONFIRMED','Direct team package activity','INFO',
        owner_wallet,NEW.user_id,sponsor_user_wallet,1,NEW.package_id,package_price,NEW.status,lower(NEW.tx_hash),
        'package_purchases',NEW.id::text,'package_purchases:'||NEW.id||':TEAM_PACKAGE_CONFIRMED:'||sponsor_user_wallet,
        COALESCE(NEW.purchased_at,NEW.created_at))
      ON CONFLICT(idempotency_key) DO NOTHING;
    END IF;

  ELSIF TG_TABLE_NAME='package_purchase_attempts' THEN
    IF NEW.user_id IS NULL OR NEW.status NOT IN('FAILED','WRONG_WALLET','WRONG_PACKAGE','WRONG_AMOUNT') THEN RETURN NEW; END IF;
    SELECT wallet_address INTO owner_wallet FROM users WHERE id=NEW.user_id;
    INSERT INTO activity_history(user_wallet,user_id,category,event_type,title,description,amount,direction,
      package_number,status,tx_hash,source_table,source_record_id,idempotency_key,metadata,occurred_at)
    VALUES(owner_wallet,NEW.user_id,'PACKAGE','PACKAGE_FAILED','Package transaction failed',NEW.reason,
      NEW.amount_token_units/1000000.0,'INFO',NEW.package_id,NEW.status,lower(NEW.tx_hash),
      'package_purchase_attempts',NEW.id::text,'package_purchase_attempts:'||NEW.id||':PACKAGE_FAILED:'||owner_wallet,
      jsonb_build_object('reason',NEW.reason),NEW.created_at)
    ON CONFLICT(idempotency_key) DO NOTHING;

  ELSIF TG_TABLE_NAME='booster_top_up_history' THEN
    SELECT wallet_address INTO owner_wallet FROM users WHERE id=NEW.user_id;
    SELECT COALESCE(sum(CASE direction WHEN 'CREDIT' THEN amount_token_units ELSE -amount_token_units END),0)
      INTO previous_units FROM booster_wallet_ledger WHERE user_id=NEW.user_id;
    current_units:=previous_units+NEW.amount_token_units;
    INSERT INTO activity_history(user_wallet,user_id,category,event_type,title,amount,direction,source_wallet,
      previous_balance,new_balance,status,tx_hash,block_number,source_table,source_record_id,idempotency_key,occurred_at)
    VALUES(owner_wallet,NEW.user_id,'BOOSTER','BOOSTER_TOPUP_CONFIRMED','Booster Wallet topped up',
      NEW.amount_token_units/1000000.0,'CREDIT',lower(NEW.sender_address),previous_units/1000000.0,current_units/1000000.0,
      COALESCE(NEW.status,'CONFIRMED'),lower(NEW.tx_hash),NEW.block_number,'booster_top_up_history',NEW.id::text,
      'booster_top_up_history:'||NEW.id||':BOOSTER_TOPUP_CONFIRMED:'||owner_wallet,NEW.created_at)
    ON CONFLICT(idempotency_key) DO NOTHING;

  ELSIF TG_TABLE_NAME='booster_income_history' THEN
    SELECT wallet_address INTO owner_wallet FROM users WHERE id=NEW.owner_user_id;
    SELECT wallet_address INTO source_user_wallet FROM users WHERE id=NEW.source_user_id;
    SELECT cycle_number INTO cycle_no FROM booster_entries WHERE id=NEW.owner_entry_id;
    INSERT INTO activity_history(user_wallet,user_id,category,event_type,title,amount,direction,source_wallet,
      source_user_id,cycle_number,position_number,status,source_table,source_record_id,idempotency_key,metadata,occurred_at)
    VALUES(owner_wallet,NEW.owner_user_id,'BOOSTER_INCOME','BOOSTER_INCOME_CREDITED','Booster income received',
      NEW.credited_amount/1000000.0,'CREDIT',source_user_wallet,NEW.source_user_id,cycle_no,NEW.slot_number,'CONFIRMED',
      'booster_income_history',NEW.id::text,'booster_income_history:'||NEW.id||':BOOSTER_INCOME_CREDITED:'||owner_wallet,
      jsonb_build_object('grossAmount',NEW.gross_amount/1000000.0,'excessAmount',NEW.excess_amount/1000000.0,
        'ledgerReference',NEW.income_credit_ledger_id),NEW.created_at)
    ON CONFLICT(idempotency_key) DO NOTHING;

  ELSIF TG_TABLE_NAME='referral_relations' THEN
    SELECT * INTO registration_row FROM registrations WHERE id=NEW.registration_id AND status='CONFIRMED';
    IF registration_row.id IS NULL THEN RETURN NEW; END IF;
    SELECT wallet_address INTO owner_wallet FROM users WHERE id=NEW.sponsor_user_id;
    SELECT wallet_address INTO source_user_wallet FROM users WHERE id=NEW.user_id;
    INSERT INTO activity_history(user_wallet,user_id,category,event_type,title,direction,source_wallet,source_user_id,
      sponsor_wallet,referral_level,status,tx_hash,block_number,source_table,source_record_id,idempotency_key,occurred_at)
    VALUES(owner_wallet,NEW.sponsor_user_id,'DIRECT_REFERRAL','DIRECT_REFERRAL_ACTIVATED','Direct referral activated',
      'INFO',source_user_wallet,NEW.user_id,owner_wallet,1,'ACTIVE',lower(registration_row.tx_hash),
      registration_row.block_number,'referral_relations',NEW.id::text,
      'referral_relations:'||NEW.id||':DIRECT_REFERRAL_ACTIVATED:'||owner_wallet,
      COALESCE(registration_row.confirmed_at,NEW.created_at))
    ON CONFLICT(idempotency_key) DO NOTHING;

  ELSIF TG_TABLE_NAME='direct_income_ledger' THEN
    SELECT wallet_address INTO owner_wallet FROM users WHERE id=NEW.sponsor_user_id;
    SELECT wallet_address INTO source_user_wallet FROM users WHERE id=NEW.source_user_id;
    SELECT p.package_id,p.amount_token_units/1000000.0 INTO cycle_no,package_price
      FROM package_purchases p WHERE p.user_id=NEW.source_user_id AND p.status='CONFIRMED'
      ORDER BY p.purchased_at,p.package_id LIMIT 1;
    INSERT INTO activity_history(user_wallet,user_id,category,event_type,title,amount,direction,source_wallet,
      source_user_id,sponsor_wallet,referral_level,package_number,package_amount,status,tx_hash,source_table,
      source_record_id,idempotency_key,metadata,occurred_at)
    VALUES(owner_wallet,NEW.sponsor_user_id,'DIRECT_INCOME','DIRECT_INCOME_CREDITED','Direct income received',
      NEW.amount_token_units/1000000.0,'CREDIT',source_user_wallet,NEW.source_user_id,owner_wallet,1,cycle_no,
      package_price,'CONFIRMED',lower(NEW.tx_hash),'direct_income_ledger',NEW.id::text,
      'direct_income_ledger:'||NEW.id||':DIRECT_INCOME_CREDITED:'||owner_wallet,
      jsonb_build_object('registrationId',NEW.registration_id,'ledgerReference',NEW.id),NEW.created_at)
    ON CONFLICT(idempotency_key) DO NOTHING;

  ELSIF TG_TABLE_NAME='magic_income_ledger' THEN
    IF NEW.beneficiary_user_id IS NULL THEN RETURN NEW; END IF;
    SELECT wallet_address INTO owner_wallet FROM users WHERE id=NEW.beneficiary_user_id;
    SELECT wallet_address INTO source_user_wallet FROM users WHERE id=NEW.source_user_id;
    INSERT INTO activity_history(user_wallet,user_id,category,event_type,title,amount,direction,source_wallet,
      source_user_id,referral_level,status,tx_hash,source_table,source_record_id,idempotency_key,metadata,occurred_at)
    SELECT owner_wallet,NEW.beneficiary_user_id,'MAGIC_LEVEL_INCOME','MAGIC_LEVEL_INCOME_CREDITED',
      'Magic Level income received',NEW.amount_token_units/1000000.0,'CREDIT',source_user_wallet,NEW.source_user_id,
      NEW.matrix_level,NEW.status,lower(c.tx_hash),'magic_income_ledger',NEW.id::text,
      'magic_income_ledger:'||NEW.id||':MAGIC_LEVEL_INCOME_CREDITED:'||owner_wallet,
      jsonb_build_object('distributionCycleId',NEW.distribution_cycle_id,'distributionDate',c.cycle_date),NEW.created_at
      FROM distribution_cycles c WHERE c.id=NEW.distribution_cycle_id
    ON CONFLICT(idempotency_key) DO NOTHING;

  ELSIF TG_TABLE_NAME='x3_income_ledger' THEN
    SELECT wallet_address INTO owner_wallet FROM users WHERE id=NEW.owner_user_id;
    SELECT wallet_address INTO source_user_wallet FROM users WHERE id=NEW.source_user_id;
    SELECT c.cycle_number,s.slot_number INTO cycle_no,slot_no FROM x3_cycles c JOIN x3_cycle_slots s ON s.id=NEW.slot_id
      WHERE c.id=NEW.owner_cycle_id;
    SELECT price_token_units/1000000.0 INTO package_price FROM package_definitions WHERE serial_number=NEW.package_id;
    INSERT INTO activity_history(user_wallet,user_id,category,event_type,title,amount,direction,source_wallet,
      source_user_id,package_number,package_amount,matrix_type,matrix_package_number,cycle_number,position_number,
      status,tx_hash,source_table,source_record_id,idempotency_key,metadata,occurred_at)
    SELECT owner_wallet,NEW.owner_user_id,'X3_INCOME','X3_INCOME_CREDITED','Working X3 income received',
      NEW.credited_amount/1000000.0,'CREDIT',source_user_wallet,NEW.source_user_id,NEW.package_id,package_price,'X3',
      NEW.package_id,cycle_no,slot_no,NEW.status,lower(s.source_transaction_hash),'x3_income_ledger',NEW.id::text,
      'x3_income_ledger:'||NEW.id||':X3_INCOME_CREDITED:'||owner_wallet,
      jsonb_build_object('grossAmount',NEW.gross_amount/1000000.0,'excessAmount',NEW.excess_amount/1000000.0,
        'ledgerReference',NEW.wallet_ledger_id),NEW.created_at FROM x3_cycle_slots s WHERE s.id=NEW.slot_id
    ON CONFLICT(idempotency_key) DO NOTHING;

  ELSIF TG_TABLE_NAME='x3_recycle_events' THEN
    SELECT wallet_address INTO owner_wallet FROM users WHERE id=NEW.user_id;
    SELECT cycle_number INTO cycle_no FROM x3_cycles WHERE id=NEW.completed_cycle_id;
    SELECT price_token_units/1000000.0 INTO package_price FROM package_definitions WHERE serial_number=NEW.package_id;
    INSERT INTO activity_history(user_wallet,user_id,category,event_type,title,direction,package_number,package_amount,
      matrix_type,matrix_package_number,cycle_number,recycle_number,status,tx_hash,source_table,source_record_id,
      idempotency_key,metadata,occurred_at)
    SELECT owner_wallet,NEW.user_id,'X3_RECYCLE','X3_RECYCLED','X3 matrix recycled','INFO',NEW.package_id,package_price,
      'X3',NEW.package_id,cycle_no,NEW.recycle_number,'COMPLETED',lower(pe.transaction_hash),'x3_recycle_events',
      NEW.id::text,'x3_recycle_events:'||NEW.id||':X3_RECYCLED:'||owner_wallet,
      jsonb_build_object('completedCycleNumber',cycle_no,'newCycleNumber',nc.cycle_number,
        'completionTimestamp',cc.completed_at,'recycleTimestamp',NEW.created_at,
        'earningsFromCompletedCycle',COALESCE((SELECT sum(i.credited_amount)/1000000.0 FROM x3_income_ledger i
          WHERE i.owner_cycle_id=NEW.completed_cycle_id),0),
        'filledPositions',(SELECT count(*) FROM x3_cycle_slots s WHERE s.cycle_id=NEW.completed_cycle_id),
        'positionWallets',COALESCE((SELECT jsonb_agg(u.wallet_address ORDER BY s.slot_number)
          FROM x3_cycle_slots s JOIN users u ON u.id=s.placed_user_id
          WHERE s.cycle_id=NEW.completed_cycle_id),'[]'::jsonb)),NEW.created_at
      FROM x3_cycles cc JOIN x3_cycles nc ON nc.id=NEW.new_cycle_id
      LEFT JOIN x3_placement_events pe ON pe.id=NEW.placement_event_id WHERE cc.id=NEW.completed_cycle_id
    ON CONFLICT(idempotency_key) DO NOTHING;

  ELSIF TG_TABLE_NAME='autopool_positions' THEN
    SELECT u.wallet_address INTO owner_wallet FROM autopool_entries e JOIN users u ON u.id=e.owner_user_id
      WHERE e.id=NEW.owner_entry_id;
    SELECT wallet_address INTO source_user_wallet FROM users WHERE id=NEW.placed_user_id;
    INSERT INTO activity_history(user_wallet,category,event_type,title,direction,source_wallet,source_user_id,
      matrix_type,cycle_number,position_number,status,source_table,source_record_id,idempotency_key,metadata,occurred_at)
    VALUES(owner_wallet,'AUTOPOOL','AUTOPOOL_PLACED','Global Autopool placement','INFO',source_user_wallet,
      NEW.placed_user_id,'AUTOPOOL',NEW.matrix_level,NEW.position_number,'CONFIRMED','autopool_positions',NEW.id::text,
      'autopool_positions:'||NEW.id||':AUTOPOOL_PLACED:'||owner_wallet,
      jsonb_build_object('parentPosition',NEW.parent_position_number,'childSlot',NEW.child_slot),NEW.created_at)
    ON CONFLICT(idempotency_key) DO NOTHING;

  ELSIF TG_TABLE_NAME='autopool_income_history' THEN
    SELECT wallet_address INTO owner_wallet FROM users WHERE id=NEW.owner_user_id;
    SELECT wallet_address INTO source_user_wallet FROM users WHERE id=NEW.source_user_id;
    SELECT position_number INTO slot_no FROM autopool_positions WHERE id=NEW.position_id;
    INSERT INTO activity_history(user_wallet,user_id,category,event_type,title,amount,direction,source_wallet,
      source_user_id,matrix_type,cycle_number,position_number,status,source_table,source_record_id,idempotency_key,
      metadata,occurred_at)
    VALUES(owner_wallet,NEW.owner_user_id,'AUTOPOOL','AUTOPOOL_INCOME_CREDITED','Global Autopool income received',
      NEW.credited_amount/1000000.0,'CREDIT',source_user_wallet,NEW.source_user_id,'AUTOPOOL',NEW.matrix_level,slot_no,
      'CONFIRMED','autopool_income_history',NEW.id::text,
      'autopool_income_history:'||NEW.id||':AUTOPOOL_INCOME_CREDITED:'||owner_wallet,
      jsonb_build_object('grossAmount',NEW.gross_amount/1000000.0,'excessAmount',NEW.excess_amount/1000000.0,
        'ledgerReference',NEW.income_credit_ledger_id),NEW.created_at)
    ON CONFLICT(idempotency_key) DO NOTHING;

  ELSIF TG_TABLE_NAME='daily_dividend_allocations' THEN
    SELECT wallet_address INTO owner_wallet FROM users WHERE id=NEW.user_id;
    SELECT amount_token_units/1000000.0 INTO package_price FROM package_purchases WHERE id=NEW.package_purchase_id;
    INSERT INTO activity_history(user_wallet,user_id,category,event_type,title,amount,direction,package_number,
      package_amount,status,source_table,source_record_id,idempotency_key,metadata,occurred_at)
    SELECT owner_wallet,NEW.user_id,'DIVIDEND','DIVIDEND_CREDITED','Daily dividend credited',
      NEW.amount/1000000.0,'CREDIT',p.package_id,package_price,'CONFIRMED','daily_dividend_allocations',NEW.id::text,
      'daily_dividend_allocations:'||NEW.id||':DIVIDEND_CREDITED:'||owner_wallet,
      jsonb_build_object('distributionDate',NEW.business_date,'distributionBatchId',NEW.settlement_id,
        'ledgerReference',NEW.income_credit_ledger_id),NEW.created_at
      FROM package_purchases p WHERE p.id=NEW.package_purchase_id
    ON CONFLICT(idempotency_key) DO NOTHING;

  ELSIF TG_TABLE_NAME='auto_withdrawals' THEN
    IF TG_OP='UPDATE' AND OLD.status=NEW.status THEN RETURN NEW; END IF;
    SELECT wallet_address INTO owner_wallet FROM users WHERE id=NEW.user_id;
    INSERT INTO activity_history(user_wallet,user_id,category,event_type,title,description,amount,direction,
      source_wallet,fee_amount,net_amount,status,tx_hash,source_table,source_record_id,idempotency_key,metadata,occurred_at)
    VALUES(owner_wallet,NEW.user_id,'WITHDRAWAL','WITHDRAWAL_'||NEW.status,
      'Withdrawal '||lower(replace(NEW.status,'_',' ')),
      (SELECT error_message FROM auto_withdrawal_attempts WHERE withdrawal_id=NEW.id ORDER BY attempt_number DESC LIMIT 1),
      NEW.gross_reserved/1000000.0,'DEBIT',lower(NEW.payout_address),NEW.fee_amount/1000000.0,
      NEW.net_payout/1000000.0,NEW.status,lower(NEW.tx_hash),'auto_withdrawals',NEW.id::text,
      'auto_withdrawals:'||NEW.id||':WITHDRAWAL_'||NEW.status||':'||owner_wallet,
      jsonb_build_object('requestDate',NEW.created_at,'statusDate',NEW.updated_at),NEW.updated_at)
    ON CONFLICT(idempotency_key) DO NOTHING;

  ELSIF TG_TABLE_NAME='income_wallet_ledger' THEN
    SELECT wallet_address INTO owner_wallet FROM users WHERE id=NEW.user_id;
    SELECT COALESCE(sum(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END),0) INTO current_units
      FROM income_wallet_ledger WHERE user_id=NEW.user_id;
    previous_units:=current_units-CASE WHEN NEW.direction='CREDIT' THEN NEW.amount ELSE -NEW.amount END;
    INSERT INTO activity_history(user_wallet,user_id,category,event_type,title,amount,direction,previous_balance,
      new_balance,status,source_table,source_record_id,idempotency_key,metadata,occurred_at)
    VALUES(owner_wallet,NEW.user_id,'WALLET','INCOME_WALLET_'||NEW.direction,'Income Wallet '||lower(NEW.direction),
      NEW.amount/1000000.0,NEW.direction::text,previous_units/1000000.0,current_units/1000000.0,'CONFIRMED',
      'income_wallet_ledger',NEW.id::text,'income_wallet_ledger:'||NEW.id||':INCOME_WALLET_'||NEW.direction||':'||owner_wallet,
      NEW.metadata||jsonb_build_object('walletType','INCOME','sourceEvent',NEW.reason),NEW.created_at)
    ON CONFLICT(idempotency_key) DO NOTHING;

  ELSIF TG_TABLE_NAME='booster_wallet_ledger' THEN
    SELECT wallet_address INTO owner_wallet FROM users WHERE id=NEW.user_id;
    SELECT COALESCE(sum(CASE direction WHEN 'CREDIT' THEN amount_token_units ELSE -amount_token_units END),0) INTO current_units
      FROM booster_wallet_ledger WHERE user_id=NEW.user_id;
    previous_units:=current_units-CASE WHEN NEW.direction='CREDIT' THEN NEW.amount_token_units ELSE -NEW.amount_token_units END;
    INSERT INTO activity_history(user_wallet,user_id,category,event_type,title,amount,direction,previous_balance,
      new_balance,status,tx_hash,source_table,source_record_id,idempotency_key,metadata,occurred_at)
    VALUES(owner_wallet,NEW.user_id,'WALLET','BOOSTER_WALLET_'||NEW.direction,'Booster Wallet '||lower(NEW.direction),
      NEW.amount_token_units/1000000.0,NEW.direction::text,previous_units/1000000.0,current_units/1000000.0,'CONFIRMED',
      lower(NEW.metadata->>'txHash'),'booster_wallet_ledger',NEW.id::text,
      'booster_wallet_ledger:'||NEW.id||':BOOSTER_WALLET_'||NEW.direction||':'||owner_wallet,
      NEW.metadata||jsonb_build_object('walletType','BOOSTER','sourceEvent',NEW.reason),NEW.created_at)
    ON CONFLICT(idempotency_key) DO NOTHING;

  ELSIF TG_TABLE_NAME='magic_wallet_ledger' THEN
    SELECT wallet_address INTO owner_wallet FROM users WHERE id=NEW.user_id;
    SELECT COALESCE(sum(CASE direction WHEN 'CREDIT' THEN amount_token_units ELSE -amount_token_units END),0) INTO current_units
      FROM magic_wallet_ledger WHERE user_id=NEW.user_id;
    previous_units:=current_units-CASE WHEN NEW.direction='CREDIT' THEN NEW.amount_token_units ELSE -NEW.amount_token_units END;
    INSERT INTO activity_history(user_wallet,user_id,category,event_type,title,amount,direction,previous_balance,
      new_balance,status,tx_hash,source_table,source_record_id,idempotency_key,metadata,occurred_at)
    VALUES(owner_wallet,NEW.user_id,'WALLET','MAGIC_WALLET_'||NEW.direction,'Wallet ledger '||lower(NEW.direction),
      NEW.amount_token_units/1000000.0,NEW.direction::text,previous_units/1000000.0,current_units/1000000.0,'CONFIRMED',
      lower(NEW.metadata->>'txHash'),'magic_wallet_ledger',NEW.id::text,
      'magic_wallet_ledger:'||NEW.id||':MAGIC_WALLET_'||NEW.direction||':'||owner_wallet,
      NEW.metadata||jsonb_build_object('walletType','MAGIC','sourceEvent',NEW.reason),NEW.created_at)
    ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS activity_history_package ON package_purchases;
CREATE TRIGGER activity_history_package AFTER INSERT OR UPDATE OF status ON package_purchases
FOR EACH ROW EXECUTE FUNCTION write_activity_history_from_source();
DROP TRIGGER IF EXISTS activity_history_package_attempt ON package_purchase_attempts;
CREATE TRIGGER activity_history_package_attempt AFTER INSERT ON package_purchase_attempts
FOR EACH ROW EXECUTE FUNCTION write_activity_history_from_source();
DROP TRIGGER IF EXISTS activity_history_booster_topup ON booster_top_up_history;
CREATE TRIGGER activity_history_booster_topup AFTER INSERT ON booster_top_up_history
FOR EACH ROW EXECUTE FUNCTION write_activity_history_from_source();
DROP TRIGGER IF EXISTS activity_history_booster_income ON booster_income_history;
CREATE TRIGGER activity_history_booster_income AFTER INSERT ON booster_income_history
FOR EACH ROW EXECUTE FUNCTION write_activity_history_from_source();
DROP TRIGGER IF EXISTS activity_history_referral ON referral_relations;
CREATE TRIGGER activity_history_referral AFTER INSERT ON referral_relations
FOR EACH ROW EXECUTE FUNCTION write_activity_history_from_source();
DROP TRIGGER IF EXISTS activity_history_direct_income ON direct_income_ledger;
CREATE TRIGGER activity_history_direct_income AFTER INSERT ON direct_income_ledger
FOR EACH ROW EXECUTE FUNCTION write_activity_history_from_source();
DROP TRIGGER IF EXISTS activity_history_magic_income ON magic_income_ledger;
CREATE TRIGGER activity_history_magic_income AFTER INSERT ON magic_income_ledger
FOR EACH ROW EXECUTE FUNCTION write_activity_history_from_source();
DROP TRIGGER IF EXISTS activity_history_x3_income ON x3_income_ledger;
CREATE TRIGGER activity_history_x3_income AFTER INSERT ON x3_income_ledger
FOR EACH ROW EXECUTE FUNCTION write_activity_history_from_source();
DROP TRIGGER IF EXISTS activity_history_x3_recycle ON x3_recycle_events;
CREATE TRIGGER activity_history_x3_recycle AFTER INSERT ON x3_recycle_events
FOR EACH ROW EXECUTE FUNCTION write_activity_history_from_source();
DROP TRIGGER IF EXISTS activity_history_autopool_position ON autopool_positions;
CREATE TRIGGER activity_history_autopool_position AFTER INSERT ON autopool_positions
FOR EACH ROW EXECUTE FUNCTION write_activity_history_from_source();
DROP TRIGGER IF EXISTS activity_history_autopool_income ON autopool_income_history;
CREATE TRIGGER activity_history_autopool_income AFTER INSERT ON autopool_income_history
FOR EACH ROW EXECUTE FUNCTION write_activity_history_from_source();
DROP TRIGGER IF EXISTS activity_history_dividend ON daily_dividend_allocations;
CREATE TRIGGER activity_history_dividend AFTER INSERT ON daily_dividend_allocations
FOR EACH ROW EXECUTE FUNCTION write_activity_history_from_source();
DROP TRIGGER IF EXISTS activity_history_withdrawal ON auto_withdrawals;
CREATE TRIGGER activity_history_withdrawal AFTER INSERT OR UPDATE OF status ON auto_withdrawals
FOR EACH ROW EXECUTE FUNCTION write_activity_history_from_source();
DROP TRIGGER IF EXISTS activity_history_income_wallet ON income_wallet_ledger;
CREATE TRIGGER activity_history_income_wallet AFTER INSERT ON income_wallet_ledger
FOR EACH ROW EXECUTE FUNCTION write_activity_history_from_source();
DROP TRIGGER IF EXISTS activity_history_booster_wallet ON booster_wallet_ledger;
CREATE TRIGGER activity_history_booster_wallet AFTER INSERT ON booster_wallet_ledger
FOR EACH ROW EXECUTE FUNCTION write_activity_history_from_source();
DROP TRIGGER IF EXISTS activity_history_magic_wallet ON magic_wallet_ledger;
CREATE TRIGGER activity_history_magic_wallet AFTER INSERT ON magic_wallet_ledger
FOR EACH ROW EXECUTE FUNCTION write_activity_history_from_source();
