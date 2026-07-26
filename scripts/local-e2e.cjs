const{spawn}=require("node:child_process");const{Client}=require("pg");const{HDNodeWallet}=require("ethers");const fs=require("node:fs");const path=require("node:path");
const root=path.resolve(__dirname,".."),children=[];const verifyOnly=process.argv.includes("--verify-only");
const mnemonic="test test test test test test test test test test test junk";
const account=i=>HDNodeWallet.fromPhrase(mnemonic,"",`m/44'/60'/0'/0/${i}`);
const keys={keeper:account(3).privateKey,executor:account(7).privateKey};
// Addresses are derived by the scenario. Private keys never enter evidence.
function run(command,args,env,stdio="inherit"){return new Promise((resolve,reject)=>{const p=spawn(command,args,{cwd:root,env,stdio,shell:process.platform==="win32"});p.on("exit",code=>code===0?resolve():reject(new Error(`${command} ${args.join(" ")} exited ${code}`)))})}
function background(command,args,env){const p=spawn(command,args,{cwd:root,env,stdio:"inherit",shell:process.platform==="win32",windowsHide:true});children.push(p);return p}
async function waitRpc(){for(let i=0;i<60;i++){try{const r=await fetch("http://127.0.0.1:8545",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_chainId",params:[]})});const j=await r.json();if(j.result==="0x7a69")return}catch{}await new Promise(r=>setTimeout(r,500))}throw new Error("Hardhat RPC did not start")}
async function waitWeb(){for(let i=0;i<120;i++){try{if((await fetch("http://127.0.0.1:3020/login")).ok)return}catch{}await new Promise(r=>setTimeout(r,500))}throw new Error("Frontend did not start")}
async function database(){
 const raw=process.env.DATABASE_URL||fs.readFileSync(path.join(root,".env"),"utf8").split(/\r?\n/).find(x=>x.startsWith("DATABASE_URL="))?.slice(13).replace(/^"|"$/g,"");
 if(!raw)throw new Error("A local PostgreSQL DATABASE_URL is required");
 const url=new URL(raw);if(!["localhost","127.0.0.1"].includes(url.hostname))throw new Error("local:e2e refuses a non-local PostgreSQL server");
 const db=`smartearning_local_e2e_${Date.now()}`;const adminUrl=new URL(url);adminUrl.pathname="/postgres";
 const client=new Client({connectionString:adminUrl.toString(),ssl:false});await client.connect();
 await client.query(`CREATE DATABASE "${db}"`);await client.end();url.pathname=`/${db}`;return url.toString();
}
async function main(){
 const db=await database(),base={...process.env,DATABASE_URL:db,DATABASE_SSL_MODE:"disable",LOCAL_E2E:"true",
  SMART_EARNING_CHAIN_ID:"31337",BSC_TESTNET_RPC_URL:"http://127.0.0.1:8545",CONFIRMATIONS_REQUIRED:"1",
  SESSION_SECRET:"local-e2e-only-session-secret-000000000000",APP_ORIGIN:"http://127.0.0.1:3020",
  AUTO_WITHDRAW_ENABLED:"true",WITHDRAWAL_BROADCAST_ENABLED:"false",NEXT_PUBLIC_USDT_DECIMALS:"6",
  NEXT_PUBLIC_SMART_EARNING_CHAIN_ID:"31337",NEXT_PUBLIC_NETWORK_NAME:"Hardhat Local",
  GENESIS_WALLET:account(1).address,KEEPER_PRIVATE_KEY:keys.keeper,
  AUTO_WITHDRAW_PRIVATE_KEY:keys.executor,WITHDRAWAL_AUTHORIZER_ADDRESS:account(8).address,
  WITHDRAWAL_AUTHORIZER_URL:"http://127.0.0.1:3999/sign-withdrawal",X3_RECOVERY_ENABLED:"true"};
 await run("npx.cmd",["hardhat","compile"],base);background("npx.cmd",["hardhat","node","--hostname","127.0.0.1"],base);await waitRpc();
 await run("npm.cmd",["run","migrate"],base);await run("npm.cmd",["run","seed:genesis"],base);
 await run("npx.cmd",["tsx","scripts/local-e2e-scenario.ts"],base);
 const runtime=Object.fromEntries(fs.readFileSync(path.join(root,"evidence/local-e2e/runtime.env"),"utf8").trim().split(/\r?\n/).map(x=>x.split(/=(.*)/s).slice(0,2)));
 const env={...base,...runtime};
 await run("npm.cmd",["run","x3:recovery"],env);await run("npm.cmd",["run","x3:recovery"],env);
 await run("npm.cmd",["run","x3:recovery-audit"],env);
 await run("npm.cmd",["run","build"],env);
 background("npm.cmd",["run","start","--","--hostname","127.0.0.1","--port","3020"],env);await waitWeb();
 await run("npx.cmd",["tsx","scripts/local-e2e-browser.ts"],env);
 if(verifyOnly){shutdown();return}
 background("npm.cmd",["run","indexer"],env);
 console.log("Local Smart Earning E2E is running at http://127.0.0.1:3020 (Ctrl+C to stop)");
 await new Promise(()=>{});
}
function shutdown(){for(const child of children)if(!child.killed)child.kill()}
process.on("SIGINT",()=>{shutdown();process.exit(0)});process.on("SIGTERM",()=>{shutdown();process.exit(0)});
main().catch(error=>{console.error(error);shutdown();process.exitCode=1});
