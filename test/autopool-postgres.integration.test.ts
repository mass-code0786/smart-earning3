import{afterAll,beforeAll,describe,expect,it}from"vitest";import{Pool,type PoolClient}from"pg";import{createAutopoolEntryForBooster}from"@/lib/server/autopool-service";
const url=process.env.AUTOPOOL_TEST_DATABASE_URL||process.env.BOOSTER_TEST_DATABASE_URL,integration=url?describe:describe.skip;
integration("Global Autopool PostgreSQL integration",()=>{const pool=new Pool({connectionString:url,ssl:false});let client:PoolClient;
 beforeAll(async()=>{client=await pool.connect();expect((await client.query("SELECT 1 FROM schema_migrations WHERE filename='012_global_autopool.sql'")).rowCount).toBe(1)});afterAll(async()=>{client.release();await pool.end()});
 it("creates idempotently, places FIFO, pays each level, completes at 242 and rolls back",async()=>{await client.query("BEGIN");try{
  const users:string[]=[],boosters:string[]=[];for(let i=0;i<244;i++){const user=(await client.query<{id:string}>("INSERT INTO users(wallet_address) VALUES($1) RETURNING id",[`0x${(910000+i).toString(16).padStart(40,"0")}`])).rows[0];users.push(user.id);await client.query(`INSERT INTO user_package_states(user_id,registration_value,total_package_value,total_eligible_value,total_earning_cap,remaining_cap) VALUES($1,2000000,1024000000,1024000000,5120000000,5120000000)`,[user.id]);const history=(await client.query<{id:string}>(`INSERT INTO booster_scheduler_history(user_id,scheduled_for,status,worker_instance) VALUES($1,now()+($2||' seconds')::interval,'COMPLETED','autopool-test') RETURNING id`,[user.id,i])).rows[0];const booster=(await client.query<{id:string}>(`INSERT INTO booster_entries(owner_user_id,cycle_number,scheduler_history_id) VALUES($1,1,$2) RETURNING id`,[user.id,history.id])).rows[0];boosters.push(booster.id)}
  const first=await createAutopoolEntryForBooster(client,{boosterEntryId:boosters[0],userId:users[0]});expect(first.duplicate).toBe(false);expect((await createAutopoolEntryForBooster(client,{boosterEntryId:boosters[0],userId:users[0]})).duplicate).toBe(true);
  for(let i=1;i<244;i++)await createAutopoolEntryForBooster(client,{boosterEntryId:boosters[i],userId:users[i]});
  const root=(await client.query<{id:string;status:string;filled_positions:number}>("SELECT id,status,filled_positions FROM autopool_entries WHERE booster_entry_id=$1",[boosters[0]])).rows[0];expect(root).toMatchObject({status:"COMPLETED",filled_positions:242});
  expect((await client.query<{levels:number[];gross:string}>(`SELECT array_agg(c ORDER BY level) levels,sum(gross)::text gross FROM (SELECT matrix_level level,count(*)::int c,sum(gross_amount) gross FROM autopool_income_history WHERE owner_entry_id=$1 GROUP BY matrix_level) x`,[root.id])).rows[0]).toEqual({levels:[2,6,18,54,162],gross:"24200000"});
  expect((await client.query<{count:string}>("SELECT count(*)::text count FROM autopool_positions WHERE owner_entry_id=$1",[root.id])).rows[0].count).toBe("242");
  const second=(await client.query<{id:string;status:string;filled_positions:number}>("SELECT id,status,filled_positions FROM autopool_entries WHERE booster_entry_id=$1",[boosters[1]])).rows[0];
  expect(second).toMatchObject({status:"ACTIVE",filled_positions:1});
  expect((await client.query<{owner_entry_id:string}>("SELECT owner_entry_id FROM autopool_positions WHERE placed_entry_id=$1",[second.id])).rows[0].owner_entry_id).toBe(root.id);
  expect((await client.query<{placed_entry_id:string;position_number:number}>("SELECT placed_entry_id,position_number FROM autopool_positions WHERE owner_entry_id=$1",[second.id])).rows[0]).toMatchObject({position_number:1});
  expect((await client.query<{total:string;placed:string;income:string}>(`SELECT
   (SELECT count(*)::text FROM autopool_positions) total,
   (SELECT count(DISTINCT placed_entry_id)::text FROM autopool_positions) placed,
   (SELECT count(*)::text FROM autopool_income_history) income`)).rows[0]).toEqual({total:"243",placed:"243",income:"243"});
  expect((await client.query<{total:string}>("SELECT count(*)::text total FROM autopool_global_queue")).rows[0].total).toBe("244");
 }finally{await client.query("ROLLBACK")}},30_000);
 it("uses a global transaction advisory lock",async()=>{const first=await pool.connect(),second=await pool.connect();try{await first.query("BEGIN");await first.query("SELECT pg_advisory_xact_lock(hashtext('autopool:global-fifo'))");expect((await second.query<{ok:boolean}>("SELECT pg_try_advisory_xact_lock(hashtext('autopool:global-fifo')) ok")).rows[0].ok).toBe(false)}finally{await first.query("ROLLBACK");first.release();second.release()}},30_000);
});
