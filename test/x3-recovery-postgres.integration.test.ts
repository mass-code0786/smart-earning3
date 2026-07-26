import{randomUUID}from"node:crypto";import{afterAll,beforeAll,describe,expect,it}from"vitest";import{Pool}from"pg";
import{recoverPendingAllocation}from"@/lib/server/x3-recovery-service";
const url=process.env.PLACEMENT_TEST_DATABASE_URL, integration=url?describe:describe.skip;
const pool=url?new Pool({connectionString:url,max:4}):null,fixtureIds:string[]=[];
async function fixture(state="PENDING",next="now()"){
  const suffix=randomUUID().replaceAll("-",""),wallet=`0x${suffix.slice(0,40)}`,tx=`0x${suffix.padEnd(64,"0").slice(0,64)}`;
  const user=(await pool!.query<{id:string}>("INSERT INTO users(wallet_address) VALUES($1) RETURNING id",[wallet])).rows[0].id;
  const definition=(await pool!.query<{id:string}>("SELECT id FROM package_definitions WHERE serial_number=1")).rows[0].id;
  const purchase=(await pool!.query<{id:string}>(`INSERT INTO package_purchases(user_id,wallet_address,package_definition_id,package_id,amount_token_units,tx_hash,status) VALUES($1,$2,$3,1,8000000,$4,'CONFIRMED') RETURNING id`,[user,wallet,definition,tx])).rows[0].id;
  const cycle=(await pool!.query<{id:string}>(`INSERT INTO x3_cycles(user_id,package_id,cycle_number,status,sponsor_user_id) VALUES($1,1,1,'COMPLETED',$1) RETURNING id`,[user])).rows[0].id;
  const pending=(await pool!.query<{id:string}>(`INSERT INTO x3_pending_allocations(package_id,source_package_purchase_id,original_allocation_amount,carried_allocation_amount,completed_cycle_id,root_user_id,status,reason,recycle_depth,idempotency_key) VALUES(1,$1,2000000,2000000,$2,$3,'RECYCLE_PENDING','test',33,$4) RETURNING id`,[purchase,cycle,user,`test:${randomUUID()}`])).rows[0].id;
  await pool!.query(`INSERT INTO x3_recovery_schedule(pending_allocation_id,recovery_state,next_attempt_at) VALUES($1,$2,${next})`,[pending,state]);
  fixtureIds.push(pending);
  return pending;
}
integration("PostgreSQL X3 recovery scheduling",()=>{
  beforeAll(()=>{if(url)process.env.DATABASE_URL=url});
  afterAll(async()=>{if(fixtureIds.length){await pool?.query("DELETE FROM operations_alerts WHERE source_reference=ANY($1::text[]) AND alert_type='X3_RECOVERY_SOURCE_MISSING'",[fixtureIds]);await pool?.query("DELETE FROM x3_recovery_schedule WHERE pending_allocation_id=ANY($1::uuid[])",[fixtureIds])}await pool?.end()});
  it("selects due records with SKIP LOCKED across independent connections",async()=>{
    const id=await fixture(),a=await pool!.connect(),b=await pool!.connect();
    try{await a.query("BEGIN");await b.query("BEGIN");
      const first=await a.query("SELECT pending_allocation_id FROM x3_recovery_schedule WHERE pending_allocation_id=$1 FOR UPDATE SKIP LOCKED",[id]);
      const second=await b.query("SELECT pending_allocation_id FROM x3_recovery_schedule WHERE pending_allocation_id=$1 FOR UPDATE SKIP LOCKED",[id]);
      expect(first.rowCount).toBe(1);expect(second.rowCount).toBe(0);
    }finally{await a.query("ROLLBACK");await b.query("ROLLBACK");a.release();b.release()}
  });
  it("excludes future, paused, and manual-review records from automatic selection",async()=>{
    const future=await fixture("RETRY_SCHEDULED","now()+interval '1 hour'"),paused=await fixture("PAUSED"),manual=await fixture("MANUAL_REVIEW");
    const result=await pool!.query(`SELECT pending_allocation_id FROM x3_recovery_schedule WHERE pending_allocation_id=ANY($1::uuid[]) AND recovery_state IN ('PENDING','RETRY_SCHEDULED') AND next_attempt_at<=now()`,[[future,paused,manual]]);
    expect(result.rowCount).toBe(0);
  });
  it("serializes the same pending advisory lock across backend connections",async()=>{
    const id=await fixture(),a=await pool!.connect(),b=await pool!.connect(),key=`x3:recovery:pending:${id}`;
    try{await a.query("BEGIN");await b.query("BEGIN");
      expect((await a.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked",[key])).rows[0].locked).toBe(true);
      expect((await b.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked",[key])).rows[0].locked).toBe(false);
    }finally{await a.query("ROLLBACK");await b.query("ROLLBACK");a.release();b.release()}
  });
  it("classifies a missing fixture lineage once and deduplicates its alert",async()=>{
    const id=await fixture();
    const first=await recoverPendingAllocation(id,"ADMIN"),second=await recoverPendingAllocation(id,"ADMIN");
    expect(first).toEqual(expect.objectContaining({status:"SKIPPED",terminalResult:"STALE"}));
    expect(second).toEqual(expect.objectContaining({status:"SKIPPED",terminalResult:"STALE"}));
    const schedule=await pool!.query("SELECT recovery_state,failure_classification FROM x3_recovery_schedule WHERE pending_allocation_id=$1",[id]);
    expect(schedule.rows[0]).toEqual(expect.objectContaining({recovery_state:"STALE",failure_classification:"SOURCE_MISSING"}));
    const alerts=await pool!.query("SELECT count(*)::int count FROM operations_alerts WHERE alert_type='X3_RECOVERY_SOURCE_MISSING' AND source_reference=$1 AND status<>'RESOLVED'",[id]);
    expect(alerts.rows[0].count).toBe(1);
  });
});
