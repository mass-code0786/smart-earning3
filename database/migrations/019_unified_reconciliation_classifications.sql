DO $$ DECLARE name text; BEGIN
 SELECT conname INTO name FROM pg_constraint WHERE conrelid='treasury_payment_reconciliation'::regclass
  AND contype='c' AND pg_get_constraintdef(oid) LIKE '%classification%';
 IF name IS NOT NULL THEN EXECUTE format('ALTER TABLE treasury_payment_reconciliation DROP CONSTRAINT %I',name); END IF;
END $$;
ALTER TABLE treasury_payment_reconciliation ADD CONSTRAINT treasury_payment_reconciliation_classification_check
 CHECK(classification IN('PAYMENT_MATCH','PAYMENT_RECEIVED_NOT_FORWARDED','TREASURY_FORWARD_AMOUNT_MISMATCH',
 'PACKAGE_STATE_WITHOUT_PAYMENT','PAYMENT_WITHOUT_PACKAGE_STATE'));
DO $$ DECLARE name text; BEGIN
 SELECT conname INTO name FROM pg_constraint WHERE conrelid='withdrawal_chain_reconciliation'::regclass
  AND contype='c' AND pg_get_constraintdef(oid) LIKE '%classification%';
 IF name IS NOT NULL THEN EXECUTE format('ALTER TABLE withdrawal_chain_reconciliation DROP CONSTRAINT %I',name); END IF;
END $$;
ALTER TABLE withdrawal_chain_reconciliation ADD CONSTRAINT withdrawal_chain_reconciliation_classification_check
 CHECK(classification IN('WITHDRAWAL_MATCH','TREASURY_LIQUIDITY_MATCH','TREASURY_LIQUIDITY_DATABASE_MISSING',
 'TREASURY_LIQUIDITY_CHAIN_MISSING','UNALLOCATED_LIQUIDITY','CONTRACT_UNEXPECTED_BALANCE',
 'WITHDRAWAL_FUNDED_NOT_PAID','WITHDRAWAL_PAID_DATABASE_PENDING','DATABASE_CONFIRMED_CHAIN_MISSING',
 'WITHDRAWAL_AMOUNT_MISMATCH','DUPLICATE_WITHDRAWAL_ID'));
