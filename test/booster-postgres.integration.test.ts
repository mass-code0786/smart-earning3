import{afterAll,beforeAll,describe,expect,it}from"vitest";import{Pool,type PoolClient}from"pg";
import{creditBoosterPackagePurchase,processBoosterUser}from"@/lib/server/booster-service";
const url=process.env.BOOSTER_TEST_DATABASE_URL,integration=url?describe:describe.skip;
integration("Booster PostgreSQL integration",()=>{
 const pool=new Pool({connectionString:url,ssl:false});let client:PoolClient;
 beforeAll(async()=>{client=await pool.connect();expect((await client.query("SELECT 1 FROM schema_migrations WHERE filename='011_booster.sql'")).rowCount).toBe(1)});
 afterAll(async()=>{client.release();await pool.end()});
 it("credits packages idempotently, schedules FIFO, pays A/B, refunds C, and rolls back fixtures",async()=>{
  await client.query("BEGIN");try{
   const definition=(await client.query<{id:string}>("SELECT id FROM package_definitions WHERE serial_number=1")).rows[0],inputs=[];
   for(let i=0;i<4;i++){const wallet=`0x${(700000+i).toString(16).padStart(40,"0")}`;
    const user=(await client.query<{id:string}>("INSERT INTO users(wallet_address) VALUES($1) RETURNING id",[wallet])).rows[0];
    await client.query(`INSERT INTO user_package_states(user_id,registration_value,total_package_value,total_eligible_value,total_earning_cap,remaining_cap)
      VALUES($1,2000000,8000000,8000000,40000000,40000000)`,[user.id]);
    const tx=`0x${(800000+i).toString(16).padStart(64,"0")}`;
    const purchase=(await client.query<{id:string}>(`INSERT INTO package_purchases(user_id,wallet_address,package_definition_id,
      package_id,amount_token_units,tx_hash,status) VALUES($1,$2,$3,1,8000000,$4,'CONFIRMED') RETURNING id`,
      [user.id,wallet,definition.id,tx])).rows[0];
    inputs.push({purchaseId:purchase.id,userId:user.id,packageId:1,amount:8_000_000n,txHash:tx});
   }
   for(const input of inputs)await creditBoosterPackagePurchase(client,input);
   expect((await creditBoosterPackagePurchase(client,inputs[0])).duplicate).toBe(true);
   for(const input of inputs)expect((await processBoosterUser(input.userId,new Date(Date.now()+1000),client)).status).toBe("COMPLETED");
   const root=inputs[0].userId;
   expect((await client.query<{v:string}>("SELECT count(*)::text v FROM booster_positions WHERE owner_entry_id=(SELECT id FROM booster_entries WHERE owner_user_id=$1)",[root])).rows[0].v).toBe("3");
   expect((await client.query<{v:string}>("SELECT sum(credited_amount)::text v FROM booster_income_history WHERE owner_user_id=$1",[root])).rows[0].v).toBe("4000000");
   expect((await client.query<{v:string}>("SELECT sum(amount_token_units)::text v FROM booster_wallet_ledger WHERE user_id=$1 AND reason='C_POSITION_REFUND'",[root])).rows[0].v).toBe("2500000");
   expect((await client.query("SELECT 1 FROM booster_entries WHERE owner_user_id=$1 AND status='COMPLETED'",[root])).rowCount).toBe(1);
   expect((await processBoosterUser(root,new Date(),client)).status).toBe("NOT_DUE");
   await client.query("UPDATE booster_memberships SET next_entry_at=now()-interval '1 second' WHERE user_id=$1",[root]);
   expect((await processBoosterUser(root,new Date(),client)).status).toBe("COMPLETED");
   expect((await client.query<{v:string}>("SELECT count(*)::text v FROM booster_entries WHERE owner_user_id=$1",[root])).rows[0].v).toBe("2");
   const empty=(await client.query<{id:string}>("INSERT INTO users(wallet_address) VALUES($1) RETURNING id",
    ["0x"+(799999).toString(16).padStart(40,"0")])).rows[0];
   await client.query("INSERT INTO booster_memberships(user_id,next_entry_at) VALUES($1,now()-interval '1 second')",[empty.id]);
   expect((await processBoosterUser(empty.id,new Date(),client)).status).toBe("INSUFFICIENT");
   const topupHash=`0x${"a".repeat(64)}`,topupSource=`0x${"b".repeat(64)}`,topupArgs=[root,topupHash,"0x"+"1".padStart(40,"0"),
    "0x"+"2".padStart(40,"0"),"0x"+"3".padStart(40,"0"),"2500000",1,3,topupSource,"0x"+"4".padStart(40,"0")];
   await client.query(`INSERT INTO booster_top_up_history(user_id,tx_hash,token_address,sender_address,
    recipient_address,amount_token_units,block_number,confirmations,source_reference,treasury_address,treasury_amount_token_units)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$6)`,topupArgs);
   await client.query("SAVEPOINT duplicate_top_up");
   await expect(client.query(`INSERT INTO booster_top_up_history(user_id,tx_hash,token_address,sender_address,
    recipient_address,amount_token_units,block_number,confirmations,source_reference,treasury_address,treasury_amount_token_units)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$6)`,topupArgs)).rejects.toMatchObject({code:"23505"});
   await client.query("ROLLBACK TO SAVEPOINT duplicate_top_up");
   await client.query("SAVEPOINT duplicate_top_up_source");
   const duplicateSource=[...topupArgs];duplicateSource[1]=`0x${"c".repeat(64)}`;
   await expect(client.query(`INSERT INTO booster_top_up_history(user_id,tx_hash,token_address,sender_address,
    recipient_address,amount_token_units,block_number,confirmations,source_reference,treasury_address,treasury_amount_token_units)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$6)`,duplicateSource)).rejects.toMatchObject({code:"23505"});
   await client.query("ROLLBACK TO SAVEPOINT duplicate_top_up_source");
  }finally{await client.query("ROLLBACK")}
 },30_000);
 it("allows only one application worker to hold the scheduler lock",async()=>{
  const first=await pool.connect(),second=await pool.connect();try{
   expect((await first.query<{ok:boolean}>("SELECT pg_try_advisory_lock(hashtext('booster:scheduler:worker')) ok")).rows[0].ok).toBe(true);
   expect((await second.query<{ok:boolean}>("SELECT pg_try_advisory_lock(hashtext('booster:scheduler:worker')) ok")).rows[0].ok).toBe(false);
  }finally{await first.query("SELECT pg_advisory_unlock_all()");await second.query("SELECT pg_advisory_unlock_all()");first.release();second.release()}
 },30_000);
 it("ignores missed intervals and creates only one entry after extended downtime",async()=>{
  await client.query("BEGIN");try{
   const wallet="0x"+(755555).toString(16).padStart(40,"0");
   const user=(await client.query<{id:string}>("INSERT INTO users(wallet_address) VALUES($1) RETURNING id",[wallet])).rows[0];
   await client.query(`INSERT INTO user_package_states(user_id,registration_value,total_package_value,total_eligible_value,total_earning_cap,remaining_cap)
    VALUES($1,2000000,1024000000,1024000000,5120000000,5120000000)`,[user.id]);
   const definition=(await client.query<{id:string}>("SELECT id FROM package_definitions WHERE serial_number=8")).rows[0];
   const tx="0x"+"b".repeat(64);
   const purchase=(await client.query<{id:string}>(`INSERT INTO package_purchases(user_id,wallet_address,
    package_definition_id,package_id,amount_token_units,tx_hash,status)
    VALUES($1,$2,$3,8,1024000000,$4,'CONFIRMED') RETURNING id`,[user.id,wallet,definition.id,tx])).rows[0];
   await creditBoosterPackagePurchase(client,{purchaseId:purchase.id,userId:user.id,packageId:8,amount:1_024_000_000n,txHash:tx});
   await client.query("UPDATE booster_memberships SET next_entry_at=now()-interval '2 days' WHERE user_id=$1",[user.id]);
   const processedAt=new Date();
   expect((await processBoosterUser(user.id,processedAt,client)).status).toBe("COMPLETED");
   expect((await processBoosterUser(user.id,processedAt,client)).status).toBe("NOT_DUE");
   expect((await client.query<{count:string}>("SELECT count(*)::text count FROM booster_entries WHERE owner_user_id=$1",[user.id])).rows[0].count).toBe("1");
   expect((await client.query<{count:string}>(
    "SELECT count(*)::text count FROM booster_wallet_ledger WHERE user_id=$1 AND reason='ENTRY_DEDUCTION'",[user.id],
   )).rows[0].count).toBe("1");
   const timing=(await client.query<{last_entry_at:Date;next_entry_at:Date}>(
    "SELECT last_entry_at,next_entry_at FROM booster_memberships WHERE user_id=$1",[user.id],
   )).rows[0];
   expect(timing.last_entry_at.getTime()).toBe(processedAt.getTime());
   expect(timing.next_entry_at.getTime()).toBe(processedAt.getTime()+4*60*60*1000);
  }finally{await client.query("ROLLBACK")}
 },30_000);
});
