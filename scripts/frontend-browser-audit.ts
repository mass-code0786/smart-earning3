import { mkdir, writeFile } from "node:fs/promises";
import { loadAuthoritativeEnvironment } from "../lib/server/production-environment";
import { SignJWT } from "jose";
import { chromium, type BrowserContext, type Page, type Route } from "playwright-core";
import { Client } from "pg";
loadAuthoritativeEnvironment(process.cwd());

const origin=process.env.BROWSER_AUDIT_ORIGIN||"http://127.0.0.1:3010";
const output="evidence/final-browser-audit";
const chrome=process.env.CHROME_PATH||"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const viewports=[{width:320,height:720},{width:360,height:800},{width:390,height:844},{width:412,height:915},{width:768,height:1024},{width:1440,height:900}];
const userRoutes=["/dashboard","/packages","/matrix/x3","/matrix/x4","/magic-level","/booster","/autopool","/dividend","/income","/team","/wallet"];
const publicRoutes=["/login","/register"],adminRoutes=["/admin"];

async function main(){
  if(!process.env.DATABASE_URL||!process.env.SESSION_SECRET)throw new Error("DATABASE_URL and SESSION_SECRET are required");
  await mkdir(output,{recursive:true});
  const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
  const admin=await wallet(db,"SELECT wallet_address FROM users WHERE role='ADMIN' AND char_length(wallet_address)=42 ORDER BY created_at LIMIT 1");
  const fallback=await wallet(db,"SELECT wallet_address FROM users WHERE status='ACTIVE' AND char_length(wallet_address)=42 ORDER BY created_at LIMIT 1")||admin;
  if(!fallback||!admin)throw new Error("Controlled user and admin fixtures are required");
  const fixtures:Record<string,string>={
    "/dashboard":await wallet(db,"SELECT u.wallet_address FROM users u JOIN earning_split_events e ON e.user_id=u.id ORDER BY e.created_at DESC LIMIT 1")||fallback,
    "/packages":await wallet(db,"SELECT u.wallet_address FROM users u JOIN user_package_states s ON s.user_id=u.id ORDER BY s.highest_package_id DESC,s.updated_at DESC LIMIT 1")||fallback,
    "/matrix/x3":await wallet(db,"SELECT u.wallet_address FROM users u JOIN x3_cycles c ON c.user_id=u.id ORDER BY c.created_at DESC LIMIT 1")||fallback,
    "/matrix/x4":await wallet(db,"SELECT u.wallet_address FROM users u JOIN x4_package_memberships m ON m.user_id=u.id ORDER BY m.created_at DESC LIMIT 1")||fallback,
    "/magic-level":await wallet(db,"SELECT u.wallet_address FROM users u JOIN magic_wallet_ledger m ON m.user_id=u.id ORDER BY m.created_at DESC LIMIT 1")||fallback,
    "/booster":await wallet(db,"SELECT u.wallet_address FROM users u JOIN booster_wallet_ledger b ON b.user_id=u.id ORDER BY b.created_at DESC LIMIT 1")||fallback,
    "/autopool":await wallet(db,"SELECT u.wallet_address FROM users u JOIN global_autopool_entries a ON a.user_id=u.id ORDER BY a.created_at DESC LIMIT 1")||fallback,
    "/dividend":await wallet(db,"SELECT u.wallet_address FROM users u JOIN daily_dividend_package_status d ON d.user_id=u.id ORDER BY d.activated_at DESC LIMIT 1")||fallback,
    "/income":await wallet(db,"SELECT u.wallet_address FROM users u JOIN auto_withdrawals w ON w.user_id=u.id ORDER BY w.created_at DESC LIMIT 1")||fallback,
    "/team":await wallet(db,"SELECT wallet_address FROM users WHERE direct_count>0 ORDER BY direct_count DESC LIMIT 1")||fallback,
    "/wallet":await wallet(db,"SELECT u.wallet_address FROM users u JOIN magic_wallet_ledger m ON m.user_id=u.id ORDER BY m.created_at DESC LIMIT 1")||fallback,
  };
  const packageFixture=await packageResponse(db,fixtures["/packages"]);
  const browserFixtures=await seedBrowserFixtures(db,admin,packageFixture);
  const browser=await chromium.launch({headless:true,executablePath:chrome,args:["--disable-gpu","--no-sandbox"]});
  const audit:{routes:any[];consoleErrors:any[];networkFailures:any[];expectedFailures:any[];fixtures:Record<string,string>}={routes:[],consoleErrors:[],networkFailures:[],expectedFailures:[],fixtures:{...fixtures,admin}};
  try{
    for(const route of [...publicRoutes,...userRoutes,...adminRoutes])for(const viewport of viewports){
      const context=await browser.newContext({viewport});
      if(userRoutes.includes(route))await authenticate(context,fixtures[route]);
      if(adminRoutes.includes(route))await authenticate(context,admin);
      const page=await context.newPage();observe(page,route,viewport.width,audit);
      await installFixtureRoutes(page,route,browserFixtures);
      const response=await page.goto(`${origin}${route}`,{waitUntil:"domcontentloaded",timeout:10_000}).catch(()=>null);
      await page.waitForTimeout(700);
      const metrics=await page.evaluate(()=>({href:location.href,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,
        bodyWidth:document.body.scrollWidth,text:document.body.innerText.slice(0,700),manualWithdrawal:[...document.querySelectorAll("button")].some(button=>/withdraw/i.test(button.textContent||""))}));
      await page.screenshot({path:`${output}/${slug(route)}-${viewport.width}x${viewport.height}.png`,fullPage:true});
      audit.routes.push({route,viewport,status:response?.status()||null,...metrics,overflow:metrics.scrollWidth>metrics.clientWidth});
      await context.close();
    }
    await verifyControlledStates(browser,db,packageFixture,fixtures["/packages"],audit);
  }finally{await browser.close();await db.end()}
  await writeFile(`${output}/console-network-report.json`,JSON.stringify(audit,null,2));
  const expectedConsole=audit.consoleErrors.filter(item=>item.route==="/dashboard?state=error"&&item.text.includes("503")).length;
  const unexpected=(audit.consoleErrors.length-expectedConsole)+audit.networkFailures.filter(item=>!(item.route==="/dashboard?state=error"&&item.status===503)).length;
  console.log(JSON.stringify({screenshots:audit.routes.length+3,routeChecks:audit.routes.length,overflow:audit.routes.filter(item=>item.overflow).length,
    consoleErrors:audit.consoleErrors.length,networkFailures:audit.networkFailures.length,unexpected},null,2));
  if(unexpected||audit.routes.some(item=>item.overflow))process.exitCode=2;
}

async function wallet(db:Client,sql:string){try{const value=(await db.query<{wallet_address:string}>(sql)).rows[0]?.wallet_address;return value&&/^0x[0-9a-f]{40}$/i.test(value)?value:null}catch{return null}}
async function authenticate(context:BrowserContext,walletAddress:string){
  const token=await new SignJWT({wallet:walletAddress,chainId:97}).setProtectedHeader({alg:"HS256"}).setSubject(walletAddress).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
  await context.addCookies([{name:"se_session",value:token,url:origin,httpOnly:true,sameSite:"Strict"}]);
}
function observe(page:Page,route:string,viewport:number,audit:any){
  page.on("console",message=>{if(message.type()==="error")audit.consoleErrors.push({route,viewport,text:message.text().slice(0,500)})});
  page.on("pageerror",error=>audit.consoleErrors.push({route,viewport,text:error.message.slice(0,500)}));
  page.on("requestfailed",request=>audit.networkFailures.push({route,viewport,url:request.url(),status:0,error:request.failure()?.errorText}));
  page.on("response",response=>{if(response.status()>=400)audit.networkFailures.push({route,viewport,url:response.url(),status:response.status()})});
}
async function packageResponse(db:Client,walletAddress:string){
  const state=(await db.query<any>(`SELECT u.id,s.* FROM users u LEFT JOIN user_package_states s ON s.user_id=u.id WHERE u.wallet_address=$1`,[walletAddress])).rows[0];
  const definitions=(await db.query<any>("SELECT serial_number,name,price_token_units::text FROM package_definitions WHERE is_active ORDER BY serial_number")).rows;
  const purchases=(await db.query<{package_id:number}>("SELECT package_id FROM package_purchases WHERE user_id=$1 AND status='CONFIRMED'",[state.id])).rows;
  const purchased=new Set(purchases.map(row=>row.package_id)),next=(state.highest_package_id||0)+1;
  const modules=(await db.query<{module_name:string;is_paused:boolean}>("SELECT module_name,is_paused FROM system_module_controls WHERE module_name=ANY($1)",[["PACKAGE_PURCHASE","X3_PLACEMENT","X4_PLACEMENT"]])).rows;
  const paused=new Map(modules.map(row=>[row.module_name,row.is_paused]));
  return{wallet:walletAddress,registered:true,nextPackage:next>8?0:next,
    packages:definitions.map((row:any)=>({packageId:row.serial_number,name:row.name,priceTokenUnits:row.price_token_units,
      capAdditionTokenUnits:(BigInt(row.price_token_units)*5n).toString(),magicAllocationTokenUnits:(BigInt(row.price_token_units)/8n).toString(),
      status:purchased.has(row.serial_number)?"PURCHASED":row.serial_number===next?"AVAILABLE":"LOCKED"})),
    totalPackageValue:String(state.total_package_value||0),registrationValue:String(state.registration_value||2_000_000),
    totalEligibleValue:String(state.total_eligible_value||0),totalEarningCap:String(state.total_earning_cap||0),
    totalEarned:String(state.total_earned||0),remainingCap:String(state.remaining_cap||0),cappingStatus:state.capping_status||"ACTIVE",
    modulePauses:{packagePurchase:paused.get("PACKAGE_PURCHASE")||false,x3Placement:paused.get("X3_PLACEMENT")||false,x4Placement:paused.get("X4_PLACEMENT")||false}};
}
async function seedBrowserFixtures(db:Client,walletAddress:string,basePackage:any){
  const now=new Date().toISOString(),hash=`0x${"ab".repeat(32)}`,source=`0x${"cd".repeat(32)}`;
  const dashboard={user:{wallet_address:walletAddress,direct_count:2,sponsor_wallet:null,tx_hash:hash,registration_status:"CONFIRMED",
    magicBalance:"9007199254740993123456",directIncomeTotal:"1000000",directIncomeToday:"1000000",
    directIncomeHistory:[{id:"direct-1",amount_token_units:"1000000",tx_hash:hash,source_wallet:"0x0000000000000000000000000000000000000002",created_at:now}],
    magicIncomeHistory:[{matrix_level:1,status:"CLAIMABLE",amount:"50000",cycle_date:"2026-07-25"}],
    financial:{income_wallet:"900000",income_reserved:"1000000",total_withdrawn:"900000",hold_wallet:"500000",booster_wallet:"2500000",dividend_income:"120000",
      gross_earned:"10000000",magic_contribution:"1000000",income_credited:"9000000",cap_total:"50000000",cap_used:"10000000",cap_remaining:"40000000",active_package:"8000000"},
    earningHistory:[{id:"earning-1",income_type:"DIRECT_INCOME",source_reference:source,gross_calculated:"1000000",capped_gross_credit:"1000000",capped_excess:"0",magic_amount:"100000",income_amount:"900000",created_at:now}]}};
  const packages={...basePackage,registered:true,nextPackage:2,totalPackageValue:"8000000",registrationValue:"2000000",totalEligibleValue:"10000000",
    totalEarningCap:"50000000",totalEarned:"10000000",remainingCap:"40000000",cappingStatus:"ACTIVE",
    packages:basePackage.packages.map((item:any)=>({...item,status:item.packageId===1?"PURCHASED":item.packageId===2?"AVAILABLE":"LOCKED"}))};
  const x3={packages:Array.from({length:8},(_,index)=>({packageId:index+1,priceTokenUnits:String(8_000_000n*2n**BigInt(index)),x3Allocation:String(2_000_000n*2n**BigInt(index)),
    active:index===0,permanentSponsor:"0x0000000000000000000000000000000000000001",matrixParent:"0x0000000000000000000000000000000000000002",
    currentCycle:index===0?2:0,slots:index===0?[{slotNumber:1,wallet:"0x0000000000000000000000000000000000000003",placementType:"DIRECT"}]:[],
    earnedIncome:index===0?"1800000":"0",heldIncome:index===0?"200000":"0",releasedIncome:index===0?"500000":"0",recycleCount:index===0?1:0}))};
  const x4={packages:Array.from({length:8},(_,index)=>({packageId:index+1,priceTokenUnits:String(8_000_000n*2n**BigInt(index)),active:index===0,currentCycle:index===0?1:0,cycleStatus:index===0?"ACTIVE":"INACTIVE",
    slots:index===0?[{slotNumber:1,level:1,wallet:"0x0000000000000000000000000000000000000004",placementType:"GLOBAL"}]:[],filledPositions:index===0?1:0,emptyPositions:index===0?5:6,recycleCount:0,
    magicLevelIncome:index===0?"500000":"0",level2Income:"0",cappedExcess:"0",totalEarnings:index===0?"500000":"0"})),
    history:[{id:"x4-1",type:"MAGIC_FUNDING",package_id:1,level:1,status:"CONFIRMED",amount:"500000",created_at:now}]};
  const booster={balance:"2500000",package_credits:"2500000",manual_top_ups:"0",refunds:"0",deductions:"0",nextEntryAt:null,server_time:now,next_entry_at:null,
    booster_wallet_balance:"2500000",eligibility:"DUE",status:"DUE",active_entries:1,completed_entries:0,total_entries:1,pending_positions:2,total_income:"2000000",
    topUpHistory:[],
    entries:[{id:"booster-1",cycle_number:1,status:"ACTIVE",positions:[],created_at:now,completed_at:null}],walletHistory:[],entryHistory:[]};
  const autopool={active_entries:1,completed_entries:0,total_entries:1,filled_positions:1,remaining_positions:13,total_income:"1000000",
    entries:[{id:"autopool-1",booster_entry_id:"booster-1",status:"ACTIVE",filled_positions:1,remaining_positions:13,created_at:now,completed_at:null,
      levels:[{level:1,capacity:2,filled:1,income:"1000000"}],positions:[{position:1,level:1,levelPosition:1,parentPosition:null,childSlot:1,wallet:walletAddress}]}],
    history:[{id:"autopool-income-1",entry_id:"autopool-1",matrix_level:1,amount:"1000000",source_wallet:"0x0000000000000000000000000000000000000005",created_at:now}]};
  const dividend={businessDate:"2026-07-25",timezone:"Asia/Kolkata",eligibleInvestment:"8000000",dailyTarget:"80000",otherIncome:"40000",todayDividend:"40000",totalDividend:"120000",
    packages:[{package_purchase_id:"package-1",package_id:1,principal_amount:"8000000",daily_target:"80000",cap_amount:"16000000",counted_income:"120000",remaining_cap:"15880000",status:"ACTIVE",activated_at:now}],
    history:[{id:"dividend-1",business_date:"2026-07-25",amount:"40000",package_id:1,created_at:now}]};
  const withdrawals={availableBalance:"900000",minimum:"1000000",withdrawals:[
    {id:"withdrawal-pending",payout_address:walletAddress,gross_reserved:"1000000",fee_amount:"100000",net_payout:"900000",status:"BROADCASTED",tx_hash:hash,attempt_count:1,created_at:now,updated_at:now},
    {id:"withdrawal-confirmed",payout_address:walletAddress,gross_reserved:"1000000",fee_amount:"100000",net_payout:"900000",status:"CONFIRMED",tx_hash:source,attempt_count:1,created_at:now,updated_at:now}]};
  const values={dashboard,packages,x3,x4,booster,autopool,dividend,withdrawals};
  await db.query("CREATE TEMP TABLE browser_audit_fixtures(name text primary key,payload jsonb not null)");
  for(const[name,payload]of Object.entries(values))await db.query("INSERT INTO browser_audit_fixtures(name,payload) VALUES($1,$2)",[name,JSON.stringify(payload)]);
  const rows=(await db.query<{name:string;payload:any}>("SELECT name,payload FROM browser_audit_fixtures")).rows;
  return Object.fromEntries(rows.map(row=>[row.name,row.payload]));
}
async function installFixtureRoutes(page:Page,route:string,fixtures:any){
  const fulfill=(payload:any)=>(request:Route)=>request.fulfill({status:200,contentType:"application/json",body:JSON.stringify(payload)});
  if(["/dashboard","/magic-level","/income","/team","/wallet"].includes(route))await page.route("**/api/dashboard",fulfill(fixtures.dashboard));
  if(["/dashboard","/packages"].includes(route))await page.route("**/api/packages",fulfill(fixtures.packages));
  if(route==="/matrix/x3")await page.route("**/api/x3/packages",fulfill(fixtures.x3));
  if(route==="/matrix/x4")await page.route("**/api/x4/packages",fulfill(fixtures.x4));
  if(route==="/booster")await page.route("**/api/booster",fulfill(fixtures.booster));
  if(route==="/autopool")await page.route("**/api/autopool",fulfill(fixtures.autopool));
  if(route==="/dividend")await page.route("**/api/dividend",fulfill(fixtures.dividend));
  if(route==="/income")await page.route("**/api/withdrawals",fulfill(fixtures.withdrawals));
}
async function verifyControlledStates(browser:any,db:Client,packageFixture:any,walletAddress:string,audit:any){
  const context=await browser.newContext({viewport:{width:390,height:844}});await authenticate(context,walletAddress);
  const page=await context.newPage();observe(page,"/packages?state=paused",390,audit);
  await page.route("**/api/packages",(request:Route)=>request.fulfill({status:200,contentType:"application/json",body:JSON.stringify({...packageFixture,modulePauses:{packagePurchase:false,x3Placement:true,x4Placement:false}})}));
  await page.goto(`${origin}/packages`,{waitUntil:"domcontentloaded"});await page.waitForTimeout(700);await page.screenshot({path:`${output}/packages-paused-390x844.png`,fullPage:true});
  const empty=await browser.newContext({viewport:{width:390,height:844}});const emptyPage=await empty.newPage();
  await emptyPage.route("**/api/x3/packages",(request:Route)=>request.fulfill({status:200,contentType:"application/json",body:JSON.stringify({packages:[]})}));
  await authenticate(empty,walletAddress);await emptyPage.goto(`${origin}/matrix/x3`,{waitUntil:"domcontentloaded"});await emptyPage.waitForTimeout(700);await emptyPage.screenshot({path:`${output}/x3-empty-390x844.png`,fullPage:true});await empty.close();
  const error=await browser.newContext({viewport:{width:390,height:844}});await authenticate(error,walletAddress);const errorPage=await error.newPage();observe(errorPage,"/dashboard?state=error",390,audit);
  await errorPage.route("**/api/dashboard",(request:Route)=>request.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Controlled backend unavailable"})}));
  await errorPage.route("**/api/packages",(request:Route)=>request.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Controlled backend unavailable"})}));
  await errorPage.goto(`${origin}/dashboard`,{waitUntil:"domcontentloaded"});await errorPage.waitForTimeout(700);await errorPage.screenshot({path:`${output}/dashboard-error-390x844.png`,fullPage:true});
  audit.expectedFailures.push({route:"/dashboard",status:503,reason:"controlled readable error-state fixture"});await error.close();await context.close();
}
function slug(route:string){return route.replaceAll("/","-").replace(/^-|-$/g,"")||"home"}
void main().catch(error=>{console.error(error instanceof Error?error.message:"Browser audit failed");process.exitCode=1});
