import type { PoolClient } from "pg";
import { getPool } from "./db";
import { recordHistory, type HistoryCategory, type HistoryWrite } from "./history-service";

type BackfillSpec = { name: string; category: HistoryCategory; sql: string };
const units = (column: string) => `(${column})/1000000.0`;
const key = (table: string, id = "s.id", event = `'${table.toUpperCase()}'`, wallet = "u.wallet_address") =>
  `'${table}:'||${id}::text||':'||${event}||':'||${wallet}`;
const json = (pairs: string) => `jsonb_build_object(${pairs}) payload`;

export const HISTORY_BACKFILL_SPECS: BackfillSpec[] = [
  {name:"package",category:"PACKAGE",sql:`SELECT s.id,${json(`
    'userWallet',u.wallet_address,'userId',s.user_id,'category','PACKAGE',
    'eventType',CASE WHEN s.package_id=1 THEN 'PACKAGE_PURCHASED' ELSE 'PACKAGE_UPGRADED' END,
    'title',CASE WHEN s.package_id=1 THEN 'Package purchased' ELSE 'Package upgraded' END,
    'amount',${units("s.amount_token_units")}::text,'direction','DEBIT','packageNumber',s.package_id,
    'packageAmount',${units("s.amount_token_units")}::text,'status',s.status,'txHash',lower(s.tx_hash),
    'blockNumber',s.block_number,'sourceTable','package_purchases','sourceRecordId',s.id,
    'idempotencyKey',${key("package_purchases","s.id","CASE WHEN s.package_id=1 THEN 'PACKAGE_PURCHASED' ELSE 'PACKAGE_UPGRADED' END")},
    'metadata',jsonb_build_object('previousPackage',GREATEST(s.package_id-1,0),'newPackage',s.package_id),
    'occurredAt',COALESCE(s.purchased_at,s.created_at)`)}
    FROM package_purchases s JOIN users u ON u.id=s.user_id WHERE s.status='CONFIRMED'`},
  {name:"team_package_activity",category:"TEAM_PACKAGE_ACTIVITY",sql:`SELECT s.id,${json(`
    'userWallet',sp.wallet_address,'category','TEAM_PACKAGE_ACTIVITY','eventType','TEAM_PACKAGE_CONFIRMED',
    'title','Direct team package activity','direction','INFO','sourceWallet',u.wallet_address,
    'sourceUserId',s.user_id,'sponsorWallet',sp.wallet_address,'referralLevel',1,
    'packageNumber',s.package_id,'packageAmount',${units("s.amount_token_units")}::text,'status',s.status,
    'txHash',lower(s.tx_hash),'sourceTable','package_purchases','sourceRecordId',s.id,
    'idempotencyKey',${key("package_purchases","s.id","'TEAM_PACKAGE_CONFIRMED'","sp.wallet_address")},
    'occurredAt',COALESCE(s.purchased_at,s.created_at)`)}
    FROM package_purchases s JOIN users u ON u.id=s.user_id JOIN referral_relations rr ON rr.user_id=s.user_id
    JOIN users sp ON sp.id=rr.sponsor_user_id WHERE s.status='CONFIRMED'`},
  {name:"booster",category:"BOOSTER",sql:`SELECT s.id,${json(`
    'userWallet',u.wallet_address,'userId',s.user_id,'category','BOOSTER','eventType','BOOSTER_TOPUP_CONFIRMED',
    'title','Booster Wallet topped up','amount',${units("s.amount_token_units")}::text,'direction','CREDIT',
    'sourceWallet',lower(s.sender_address),'status',s.status,'txHash',lower(s.tx_hash),'blockNumber',s.block_number,
    'sourceTable','booster_top_up_history','sourceRecordId',s.id,
    'idempotencyKey',${key("booster_top_up_history","s.id","'BOOSTER_TOPUP_CONFIRMED'")},
    'occurredAt',s.created_at`)}
    FROM booster_top_up_history s JOIN users u ON u.id=s.user_id WHERE s.status='CONFIRMED'`},
  {name:"booster_income",category:"BOOSTER_INCOME",sql:`SELECT s.id,${json(`
    'userWallet',u.wallet_address,'userId',s.owner_user_id,'category','BOOSTER_INCOME',
    'eventType','BOOSTER_INCOME_CREDITED','title','Booster income received',
    'amount',${units("s.credited_amount")}::text,'direction','CREDIT','sourceWallet',su.wallet_address,
    'sourceUserId',s.source_user_id,'cycleNumber',e.cycle_number,'positionNumber',s.slot_number,'status','CONFIRMED',
    'sourceTable','booster_income_history','sourceRecordId',s.id,
    'idempotencyKey',${key("booster_income_history","s.id","'BOOSTER_INCOME_CREDITED'")},
    'metadata',jsonb_build_object('grossAmount',${units("s.gross_amount")},'excessAmount',${units("s.excess_amount")},
      'ledgerReference',s.income_credit_ledger_id),'occurredAt',s.created_at`)}
    FROM booster_income_history s JOIN users u ON u.id=s.owner_user_id JOIN users su ON su.id=s.source_user_id
    JOIN booster_entries e ON e.id=s.owner_entry_id`},
  {name:"direct_referral",category:"DIRECT_REFERRAL",sql:`SELECT rr.id,${json(`
    'userWallet',u.wallet_address,'userId',rr.sponsor_user_id,'category','DIRECT_REFERRAL',
    'eventType','DIRECT_REFERRAL_ACTIVATED','title','Direct referral activated','direction','INFO',
    'sourceWallet',su.wallet_address,'sourceUserId',rr.user_id,'sponsorWallet',u.wallet_address,
    'referralLevel',1,'status','ACTIVE','txHash',lower(r.tx_hash),'blockNumber',r.block_number,
    'sourceTable','referral_relations','sourceRecordId',rr.id,
    'idempotencyKey',${key("referral_relations","rr.id","'DIRECT_REFERRAL_ACTIVATED'")},
    'occurredAt',COALESCE(r.confirmed_at,rr.created_at)`)}
    FROM referral_relations rr JOIN registrations r ON r.id=rr.registration_id AND r.status='CONFIRMED'
    JOIN users u ON u.id=rr.sponsor_user_id JOIN users su ON su.id=rr.user_id`},
  {name:"direct_income",category:"DIRECT_INCOME",sql:`SELECT s.id,${json(`
    'userWallet',u.wallet_address,'userId',s.sponsor_user_id,'category','DIRECT_INCOME',
    'eventType','DIRECT_INCOME_CREDITED','title','Direct income received','amount',${units("s.amount_token_units")}::text,
    'direction','CREDIT','sourceWallet',su.wallet_address,'sourceUserId',s.source_user_id,
    'sponsorWallet',u.wallet_address,'referralLevel',1,'packageNumber',p.package_id,
    'packageAmount',${units("p.amount_token_units")}::text,'status','CONFIRMED','txHash',lower(s.tx_hash),
    'sourceTable','direct_income_ledger','sourceRecordId',s.id,
    'idempotencyKey',${key("direct_income_ledger","s.id","'DIRECT_INCOME_CREDITED'")},
    'metadata',jsonb_build_object('registrationId',s.registration_id,'ledgerReference',s.id),'occurredAt',s.created_at`)}
    FROM direct_income_ledger s JOIN users u ON u.id=s.sponsor_user_id JOIN users su ON su.id=s.source_user_id
    LEFT JOIN LATERAL(SELECT p.package_id,p.amount_token_units FROM package_purchases p
      WHERE p.user_id=s.source_user_id AND p.status='CONFIRMED' ORDER BY p.purchased_at,p.package_id LIMIT 1)p ON true`},
  {name:"magic_level_income",category:"MAGIC_LEVEL_INCOME",sql:`SELECT s.id,${json(`
    'userWallet',u.wallet_address,'userId',s.beneficiary_user_id,'category','MAGIC_LEVEL_INCOME',
    'eventType','MAGIC_LEVEL_INCOME_CREDITED','title','Magic Level income received',
    'amount',${units("s.amount_token_units")}::text,'direction','CREDIT','sourceWallet',su.wallet_address,
    'sourceUserId',s.source_user_id,'referralLevel',s.matrix_level,'status',s.status,'txHash',lower(c.tx_hash),
    'sourceTable','magic_income_ledger','sourceRecordId',s.id,
    'idempotencyKey',${key("magic_income_ledger","s.id","'MAGIC_LEVEL_INCOME_CREDITED'")},
    'metadata',jsonb_build_object('distributionCycleId',s.distribution_cycle_id,'distributionDate',c.cycle_date),
    'occurredAt',s.created_at`)}
    FROM magic_income_ledger s JOIN users u ON u.id=s.beneficiary_user_id JOIN users su ON su.id=s.source_user_id
    JOIN distribution_cycles c ON c.id=s.distribution_cycle_id WHERE s.beneficiary_user_id IS NOT NULL`},
  {name:"x3_income",category:"X3_INCOME",sql:`SELECT s.id,${json(`
    'userWallet',u.wallet_address,'userId',s.owner_user_id,'category','X3_INCOME','eventType','X3_INCOME_CREDITED',
    'title','Working X3 income received','amount',${units("s.credited_amount")}::text,'direction','CREDIT',
    'sourceWallet',su.wallet_address,'sourceUserId',s.source_user_id,'packageNumber',s.package_id,
    'packageAmount',${units("pd.price_token_units")}::text,'matrixType','X3','matrixPackageNumber',s.package_id,
    'cycleNumber',c.cycle_number,'positionNumber',sl.slot_number,'status',s.status,
    'txHash',lower(sl.source_transaction_hash),'sourceTable','x3_income_ledger','sourceRecordId',s.id,
    'idempotencyKey',${key("x3_income_ledger","s.id","'X3_INCOME_CREDITED'")},
    'metadata',jsonb_build_object('grossAmount',${units("s.gross_amount")},'excessAmount',${units("s.excess_amount")},
      'ledgerReference',s.wallet_ledger_id),'occurredAt',s.created_at`)}
    FROM x3_income_ledger s JOIN users u ON u.id=s.owner_user_id JOIN users su ON su.id=s.source_user_id
    JOIN x3_cycles c ON c.id=s.owner_cycle_id JOIN x3_cycle_slots sl ON sl.id=s.slot_id
    JOIN package_definitions pd ON pd.serial_number=s.package_id`},
  {name:"x3_recycle",category:"X3_RECYCLE",sql:`SELECT s.id,${json(`
    'userWallet',u.wallet_address,'userId',s.user_id,'category','X3_RECYCLE','eventType','X3_RECYCLED',
    'title','X3 matrix recycled','direction','INFO','packageNumber',s.package_id,
    'packageAmount',${units("pd.price_token_units")}::text,'matrixType','X3','matrixPackageNumber',s.package_id,
    'cycleNumber',cc.cycle_number,'recycleNumber',s.recycle_number,'status','COMPLETED',
    'txHash',lower(pe.transaction_hash),'sourceTable','x3_recycle_events','sourceRecordId',s.id,
    'idempotencyKey',${key("x3_recycle_events","s.id","'X3_RECYCLED'")},
    'metadata',jsonb_build_object('completedCycleNumber',cc.cycle_number,'newCycleNumber',nc.cycle_number,
      'completionTimestamp',cc.completed_at,'recycleTimestamp',s.created_at,
      'earningsFromCompletedCycle',COALESCE((SELECT sum(i.credited_amount)/1000000.0 FROM x3_income_ledger i WHERE i.owner_cycle_id=cc.id),0),
      'filledPositions',(SELECT count(*) FROM x3_cycle_slots xs WHERE xs.cycle_id=cc.id),
      'positionWallets',COALESCE((SELECT jsonb_agg(pu.wallet_address ORDER BY xs.slot_number)
        FROM x3_cycle_slots xs JOIN users pu ON pu.id=xs.placed_user_id WHERE xs.cycle_id=cc.id),'[]'::jsonb)),
    'occurredAt',s.created_at`)}
    FROM x3_recycle_events s JOIN users u ON u.id=s.user_id JOIN x3_cycles cc ON cc.id=s.completed_cycle_id
    JOIN x3_cycles nc ON nc.id=s.new_cycle_id JOIN package_definitions pd ON pd.serial_number=s.package_id
    LEFT JOIN x3_placement_events pe ON pe.id=s.placement_event_id`},
  {name:"autopool",category:"AUTOPOOL",sql:`SELECT s.id,${json(`
    'userWallet',u.wallet_address,'userId',s.owner_user_id,'category','AUTOPOOL',
    'eventType','AUTOPOOL_INCOME_CREDITED','title','Global Autopool income received',
    'amount',${units("s.credited_amount")}::text,'direction','CREDIT','sourceWallet',su.wallet_address,
    'sourceUserId',s.source_user_id,'matrixType','AUTOPOOL','cycleNumber',s.matrix_level,
    'positionNumber',p.position_number,'status','CONFIRMED','sourceTable','autopool_income_history',
    'sourceRecordId',s.id,'idempotencyKey',${key("autopool_income_history","s.id","'AUTOPOOL_INCOME_CREDITED'")},
    'metadata',jsonb_build_object('ledgerReference',s.income_credit_ledger_id,'parentPosition',p.parent_position_number),
    'occurredAt',s.created_at`)}
    FROM autopool_income_history s JOIN users u ON u.id=s.owner_user_id JOIN users su ON su.id=s.source_user_id
    JOIN autopool_positions p ON p.id=s.position_id`},
  {name:"autopool_placement",category:"AUTOPOOL",sql:`SELECT s.id,${json(`
    'userWallet',u.wallet_address,'userId',e.owner_user_id,'category','AUTOPOOL','eventType','AUTOPOOL_PLACED',
    'title','Global Autopool placement','direction','INFO','sourceWallet',su.wallet_address,
    'sourceUserId',s.placed_user_id,'matrixType','AUTOPOOL','cycleNumber',s.matrix_level,
    'positionNumber',s.position_number,'status','CONFIRMED','sourceTable','autopool_positions',
    'sourceRecordId',s.id,'idempotencyKey',${key("autopool_positions","s.id","'AUTOPOOL_PLACED'")},
    'metadata',jsonb_build_object('parentPosition',s.parent_position_number,'childSlot',s.child_slot),
    'occurredAt',s.created_at`)}
    FROM autopool_positions s JOIN autopool_entries e ON e.id=s.owner_entry_id
    JOIN users u ON u.id=e.owner_user_id JOIN users su ON su.id=s.placed_user_id`},
  {name:"dividend",category:"DIVIDEND",sql:`SELECT s.id,${json(`
    'userWallet',u.wallet_address,'userId',s.user_id,'category','DIVIDEND','eventType','DIVIDEND_CREDITED',
    'title','Daily dividend credited','amount',${units("s.amount")}::text,'direction','CREDIT',
    'packageNumber',p.package_id,'packageAmount',${units("p.amount_token_units")}::text,'status','CONFIRMED',
    'sourceTable','daily_dividend_allocations','sourceRecordId',s.id,
    'idempotencyKey',${key("daily_dividend_allocations","s.id","'DIVIDEND_CREDITED'")},
    'metadata',jsonb_build_object('distributionDate',s.business_date,'distributionBatchId',s.settlement_id,
      'ledgerReference',s.income_credit_ledger_id),'occurredAt',s.created_at`)}
    FROM daily_dividend_allocations s JOIN users u ON u.id=s.user_id JOIN package_purchases p ON p.id=s.package_purchase_id`},
  {name:"withdrawal",category:"WITHDRAWAL",sql:`SELECT s.id,${json(`
    'userWallet',u.wallet_address,'userId',s.user_id,'category','WITHDRAWAL',
    'eventType','WITHDRAWAL_'||s.status,'title','Withdrawal '||lower(replace(s.status,'_',' ')),
    'amount',${units("s.gross_reserved")}::text,'direction','DEBIT','sourceWallet',lower(s.payout_address),
    'feeAmount',${units("s.fee_amount")}::text,'netAmount',${units("s.net_payout")}::text,'status',s.status,
    'txHash',lower(s.tx_hash),'sourceTable','auto_withdrawals','sourceRecordId',s.id,
    'idempotencyKey',${key("auto_withdrawals","s.id","'WITHDRAWAL_'||s.status")},
    'metadata',jsonb_build_object('requestDate',s.created_at,'statusDate',s.updated_at),'occurredAt',s.updated_at`)}
    FROM auto_withdrawals s JOIN users u ON u.id=s.user_id`},
  {name:"withdrawal_lifecycle",category:"WITHDRAWAL",sql:`SELECT a.id,${json(`
    'userWallet',u.wallet_address,'userId',w.user_id,'category','WITHDRAWAL',
    'eventType','WITHDRAWAL_'||CASE WHEN a.event_type='BROADCAST_PREPARED' THEN 'BROADCASTING' ELSE a.event_type END,
    'title','Withdrawal '||lower(replace(CASE WHEN a.event_type='BROADCAST_PREPARED' THEN 'PROCESSING' ELSE a.event_type END,'_',' ')),
    'amount',${units("w.gross_reserved")}::text,'direction','DEBIT','sourceWallet',lower(w.payout_address),
    'feeAmount',${units("w.fee_amount")}::text,'netAmount',${units("w.net_payout")}::text,
    'status',CASE WHEN a.event_type='BROADCAST_PREPARED' THEN 'BROADCASTING' ELSE a.event_type END,
    'txHash',lower(COALESCE(a.metadata->>'txHash',w.tx_hash)),'sourceTable','auto_withdrawals',
    'sourceRecordId',w.id,'idempotencyKey',${key("auto_withdrawals","w.id","'WITHDRAWAL_'||CASE WHEN a.event_type='BROADCAST_PREPARED' THEN 'BROADCASTING' ELSE a.event_type END")},
    'metadata',a.metadata||jsonb_build_object('requestDate',w.created_at,'statusDate',a.created_at),
    'occurredAt',a.created_at`)}
    FROM auto_withdrawal_audit_logs a JOIN auto_withdrawals w ON w.id=a.withdrawal_id
    JOIN users u ON u.id=w.user_id WHERE a.event_type IN('RESERVED','BROADCAST_PREPARED','BROADCASTED','CONFIRMED')`},
  {name:"income_wallet",category:"WALLET",sql:`SELECT s.id,${json(`
    'userWallet',u.wallet_address,'userId',s.user_id,'category','WALLET',
    'eventType','INCOME_WALLET_'||s.direction,'title','Income Wallet '||lower(s.direction::text),
    'amount',${units("s.amount")}::text,'direction',s.direction::text,
    'previousBalance',${units("s.running_balance-CASE WHEN s.direction='CREDIT' THEN s.amount ELSE -s.amount END")}::text,
    'newBalance',${units("s.running_balance")}::text,'status','CONFIRMED','sourceTable','income_wallet_ledger',
    'sourceRecordId',s.id,'idempotencyKey',${key("income_wallet_ledger","s.id","'INCOME_WALLET_'||s.direction")},
    'metadata',s.metadata||jsonb_build_object('walletType','INCOME','sourceEvent',s.reason),'occurredAt',s.created_at`)}
    FROM (SELECT l.*,sum(CASE direction WHEN 'CREDIT' THEN amount ELSE -amount END)
      OVER(PARTITION BY user_id ORDER BY created_at,id) running_balance FROM income_wallet_ledger l)s
    JOIN users u ON u.id=s.user_id`},
  {name:"booster_wallet",category:"WALLET",sql:`SELECT s.id,${json(`
    'userWallet',u.wallet_address,'userId',s.user_id,'category','WALLET',
    'eventType','BOOSTER_WALLET_'||s.direction,'title','Booster Wallet '||lower(s.direction::text),
    'amount',${units("s.amount_token_units")}::text,'direction',s.direction::text,
    'previousBalance',${units("s.running_balance-CASE WHEN s.direction='CREDIT' THEN s.amount_token_units ELSE -s.amount_token_units END")}::text,
    'newBalance',${units("s.running_balance")}::text,'status','CONFIRMED',
    'txHash',lower(s.metadata->>'txHash'),'sourceTable','booster_wallet_ledger','sourceRecordId',s.id,
    'idempotencyKey',${key("booster_wallet_ledger","s.id","'BOOSTER_WALLET_'||s.direction")},
    'metadata',s.metadata||jsonb_build_object('walletType','BOOSTER','sourceEvent',s.reason),'occurredAt',s.created_at`)}
    FROM (SELECT l.*,sum(CASE direction WHEN 'CREDIT' THEN amount_token_units ELSE -amount_token_units END)
      OVER(PARTITION BY user_id ORDER BY created_at,id) running_balance FROM booster_wallet_ledger l)s
    JOIN users u ON u.id=s.user_id`},
  {name:"magic_wallet",category:"WALLET",sql:`SELECT s.id,${json(`
    'userWallet',u.wallet_address,'userId',s.user_id,'category','WALLET',
    'eventType','MAGIC_WALLET_'||s.direction,'title','Wallet ledger '||lower(s.direction::text),
    'amount',${units("s.amount_token_units")}::text,'direction',s.direction::text,
    'previousBalance',${units("s.running_balance-CASE WHEN s.direction='CREDIT' THEN s.amount_token_units ELSE -s.amount_token_units END")}::text,
    'newBalance',${units("s.running_balance")}::text,'status','CONFIRMED',
    'txHash',lower(s.metadata->>'txHash'),'sourceTable','magic_wallet_ledger','sourceRecordId',s.id,
    'idempotencyKey',${key("magic_wallet_ledger","s.id","'MAGIC_WALLET_'||s.direction")},
    'metadata',s.metadata||jsonb_build_object('walletType','MAGIC','sourceEvent',s.reason),'occurredAt',s.created_at`)}
    FROM (SELECT l.*,sum(CASE direction WHEN 'CREDIT' THEN amount_token_units ELSE -amount_token_units END)
      OVER(PARTITION BY user_id ORDER BY created_at,id) running_balance FROM magic_wallet_ledger l)s
    JOIN users u ON u.id=s.user_id`},
];

export type BackfillOptions = { dryRun?: boolean; batchSize?: number; category?: string | null };

export async function backfillHistory(options: BackfillOptions = {}) {
  const batchSize = Math.min(5000, Math.max(1, options.batchSize || 500));
  const requested = options.category?.trim().toUpperCase();
  const specs = HISTORY_BACKFILL_SPECS.filter(spec =>
    !requested || spec.category === requested || spec.name.toUpperCase() === requested,
  );
  if (requested && !specs.length) throw new Error(`Unsupported history backfill category: ${requested}`);
  const client = await getPool().connect();
  const counts: Record<string, { candidates: number; inserted: number }> = {};
  try {
    for (const spec of specs) {
      const count = await client.query<{ count: string }>(`SELECT count(*)::text count FROM (${spec.sql}) q`);
      counts[spec.category] ||= { candidates: 0, inserted: 0 };
      counts[spec.category].candidates += Number(count.rows[0]?.count || 0);
      if (options.dryRun) continue;
      let cursor: string | null = null;
      for (;;) {
        await client.query("BEGIN");
        try {
          const batch: { id: string; payload: HistoryWrite }[] = (await client.query(
            `SELECT * FROM (${spec.sql}) q WHERE ($1::uuid IS NULL OR q.id>$1::uuid) ORDER BY q.id LIMIT $2`,
            [cursor, batchSize],
          )).rows;
          for (const row of batch) {
            const result = await recordHistory(client as PoolClient, row.payload);
            if (!result.duplicate) counts[spec.category].inserted++;
          }
          await client.query("COMMIT");
          if (batch.length < batchSize) break;
          cursor = batch[batch.length - 1].id;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    }
    return { dryRun: Boolean(options.dryRun), batchSize, counts };
  } finally {
    client.release();
  }
}
