import{afterAll,beforeAll,describe,expect,it}from"vitest";
import{Pool,type PoolClient}from"pg";
import{processX4PackagePurchase}from"@/lib/server/x4-service";

const url=process.env.X4_TEST_DATABASE_URL;
const integration=url?describe:describe.skip;
integration("X4 PostgreSQL engine",()=>{
  const pool=new Pool({connectionString:url,ssl:false}),clients:PoolClient[]=[];
  beforeAll(async()=>{
    const migrations=await pool.query("SELECT filename FROM schema_migrations WHERE filename='010_x4_global_matrix.sql'");
    if(!migrations.rowCount)throw new Error("X4 migration is not applied to X4_TEST_DATABASE_URL");
  });
  afterAll(async()=>{for(const client of clients)client.release();await pool.end()});

  it("atomically places FIFO, credits both ledgers, recycles, and rejects duplicates",async()=>{
    const client=await pool.connect();clients.push(client);await client.query("BEGIN");
    try{
      const definition=(await client.query<{id:string}>("SELECT id FROM package_definitions WHERE serial_number=1")).rows[0];
      const inputs=[];
      for(let index=0;index<7;index++){
        const wallet=`0x${(900000+index).toString(16).padStart(40,"0")}`;
        const user=(await client.query<{id:string}>(
          "INSERT INTO users(wallet_address,status) VALUES($1,'ACTIVE') RETURNING id",[wallet],
        )).rows[0];
        await client.query(
          `INSERT INTO user_package_states(
             user_id,highest_package_id,total_package_value,registration_value,total_eligible_value,
             total_earning_cap,total_earned,remaining_cap
           ) VALUES($1,1,8000000,2000000,10000000,50000000,0,50000000)`,[user.id],
        );
        const tx=`0x${(500000+index).toString(16).padStart(64,"0")}`;
        const purchase=(await client.query<{id:string}>(
          `INSERT INTO package_purchases(
             user_id,wallet_address,package_definition_id,package_id,amount_token_units,
             tx_hash,block_number,status,purchased_at
           ) VALUES($1,$2,$3,1,8000000,$4,1,'CONFIRMED',now()) RETURNING id`,
          [user.id,wallet,definition.id,tx],
        )).rows[0];
        const rootWallet=`0x${(900000).toString(16).padStart(40,"0")}`;
        const slot=index===0?0:index,level=index===0?0:index<=2?1:2;
        inputs.push({purchaseId:purchase.id,userId:user.id,packageId:1,amount:8_000_000n,
          txHash:tx,blockNumber:1,sourceEventId:null,onchain:{user:wallet,
            owner:index===0?"0x0000000000000000000000000000000000000000":rootWallet,
            slot,level,accountingAmount:index===0?0n:level===1?500_000n:1_250_000n,
            magicSourceReference:level===1?`0x${(700000+index).toString(16).padStart(64,"0")}`:undefined,
            confirmedGrossCredit:level===2?1_250_000n:undefined}});
      }
      for(const input of inputs)await processX4PackagePurchase(client,input);
      const duplicate=await processX4PackagePurchase(client,inputs[0]);
      expect(duplicate.duplicate).toBe(true);

      const root=inputs[0].userId;
      expect((await client.query("SELECT 1 FROM x4_cycles WHERE user_id=$1 AND cycle_number=1 AND status='COMPLETED'",[root])).rowCount).toBe(1);
      expect((await client.query("SELECT 1 FROM x4_cycles WHERE user_id=$1 AND cycle_number=2 AND status='ACTIVE'",[root])).rowCount).toBe(1);
      expect(Number((await client.query<{count:string}>("SELECT count(*)::text count FROM x4_positions WHERE owner_cycle_id=(SELECT id FROM x4_cycles WHERE user_id=$1 AND cycle_number=1)",[root])).rows[0].count)).toBe(6);
      expect((await client.query<{amount:string}>(
        "SELECT COALESCE(sum(amount),0)::text amount FROM magic_funding_events WHERE user_id=$1 AND source_type IN('X4_LEVEL_1_A_MAGIC','X4_LEVEL_1_B_MAGIC') AND status='CONFIRMED'",[root],
      )).rows[0].amount).toBe("1000000");
      expect((await client.query<{amount:string}>(
        "SELECT COALESCE(sum(credited_amount),0)::text amount FROM income_credit_ledger WHERE user_id=$1 AND income_type='X4_GLOBAL'",[root],
      )).rows[0].amount).toBe("5000000");
      expect((await client.query<{count:string}>("SELECT count(*)::text count FROM x4_recycle_history WHERE user_id=$1",[root])).rows[0].count).toBe("1");
      expect((await client.query<{count:string}>("SELECT count(*)::text count FROM x4_package_memberships")).rows[0].count).toBe("7");
    }finally{await client.query("ROLLBACK")}
  });

  it("uses one concurrency lock domain per package",async()=>{
    const first=await pool.connect(),second=await pool.connect();clients.push(first,second);
    try{
      expect((await first.query<{ok:boolean}>("SELECT pg_try_advisory_lock(hashtext($1)) ok",["x4:package:1"])).rows[0].ok).toBe(true);
      expect((await second.query<{ok:boolean}>("SELECT pg_try_advisory_lock(hashtext($1)) ok",["x4:package:1"])).rows[0].ok).toBe(false);
      expect((await second.query<{ok:boolean}>("SELECT pg_try_advisory_lock(hashtext($1)) ok",["x4:package:2"])).rows[0].ok).toBe(true);
    }finally{await first.query("SELECT pg_advisory_unlock_all()");await second.query("SELECT pg_advisory_unlock_all()")}
  });

  it("leaves no X4 records when the surrounding purchase transaction rolls back",async()=>{
    const client=await pool.connect();clients.push(client);
    const marker=`0x${Date.now().toString(16).padStart(40,"0").slice(-40)}`;
    let purchaseId="";
    await client.query("BEGIN");
    try{
      const user=(await client.query<{id:string}>("INSERT INTO users(wallet_address) VALUES($1) RETURNING id",[marker])).rows[0];
      await client.query(`INSERT INTO user_package_states(
        user_id,registration_value,total_eligible_value,total_earning_cap,remaining_cap
      ) VALUES($1,2000000,2000000,10000000,10000000)`,[user.id]);
      const definition=(await client.query<{id:string}>("SELECT id FROM package_definitions WHERE serial_number=1")).rows[0];
      const purchase=(await client.query<{id:string}>(`INSERT INTO package_purchases(
        user_id,wallet_address,package_definition_id,package_id,amount_token_units,tx_hash,status
      ) VALUES($1,$2,$3,1,8000000,$4,'CONFIRMED') RETURNING id`,
      [user.id,marker,definition.id,`0x${Date.now().toString(16).padStart(64,"0")}`])).rows[0];
      purchaseId=purchase.id;
      await processX4PackagePurchase(client,{purchaseId,userId:user.id,packageId:1,amount:8_000_000n,
        txHash:`0x${"f".repeat(64)}`,blockNumber:1,sourceEventId:null,onchain:{user:marker,
          owner:"0x0000000000000000000000000000000000000000",slot:0,level:0,accountingAmount:0n}});
      throw new Error("simulated downstream failure");
    }catch(error){
      expect((error as Error).message).toBe("simulated downstream failure");
      await client.query("ROLLBACK");
    }
    expect((await client.query("SELECT 1 FROM x4_package_memberships WHERE activation_purchase_id=$1",[purchaseId])).rowCount).toBe(0);
  });
});
