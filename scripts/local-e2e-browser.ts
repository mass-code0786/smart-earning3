import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { SignJWT } from "jose";
import { Pool } from "pg";

async function main(){
  if(process.env.LOCAL_E2E!=="true"||process.env.SMART_EARNING_CHAIN_ID!=="31337")
    throw new Error("Local browser audit requires the isolated Hardhat profile");
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  const wallet=(await pool.query<{wallet_address:string}>(
    "SELECT wallet_address FROM users WHERE role<>'ADMIN' ORDER BY activated_at LIMIT 1")).rows[0]?.wallet_address;
  const admin=(await pool.query<{wallet_address:string}>(
    "SELECT wallet_address FROM users WHERE role='ADMIN' ORDER BY created_at LIMIT 1")).rows[0]?.wallet_address;
  if(!wallet)throw new Error("Local E2E user was not indexed");
  const sign=async(address:string)=>new SignJWT({wallet:address,chainId:31337}).setProtectedHeader({alg:"HS256"})
    .setSubject(address).setIssuedAt().setExpirationTime("30m")
    .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
  const token=await sign(wallet);
  const chrome="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const browser=await chromium.launch({headless:true,executablePath:fs.existsSync(chrome)?chrome:undefined});
  const routes=["dashboard","packages","matrix/x3","matrix/x4","magic-level","booster","autopool","dividend","income","wallet","team","admin"];
  const viewports=[{name:"mobile",width:390,height:844},{name:"desktop",width:1440,height:900}];
  const output=path.resolve("evidence/local-e2e/screenshots");fs.mkdirSync(output,{recursive:true});
  const networkOutput=path.resolve("evidence/local-e2e/network");fs.mkdirSync(networkOutput,{recursive:true});
  const errors:Array<Record<string,unknown>>=[];
  const checks:Array<Record<string,unknown>>=[];
  for(const viewport of viewports){
    const context=await browser.newContext({
      viewport:{width:viewport.width,height:viewport.height},
      recordHar:{path:path.join(networkOutput,`${viewport.name}.har`),mode:"full"},
    });
    await context.addCookies([{name:"se_session",value:token,url:"http://127.0.0.1:3020",httpOnly:true,sameSite:"Strict"}]);
    for(const route of routes){
      if(route==="admin"&&admin)await context.addCookies([{name:"se_session",value:await sign(admin),
        url:"http://127.0.0.1:3020",httpOnly:true,sameSite:"Strict"}]);
      const page=await context.newPage();
      const connectedWallet=route==="admin"&&admin?admin:wallet;
      await page.addInitScript({content:`{
        const address=${JSON.stringify(connectedWallet)};
        const listeners=new Map();
        const provider={
          request:async({method})=>{
            if(method==="eth_accounts"||method==="eth_requestAccounts")return[address];
            if(method==="eth_chainId")return"0x7a69";
            throw new Error("Unsupported local E2E wallet method: "+method);
          },
          on:(event,listener)=>{
            const registered=listeners.get(event)||new Set();registered.add(listener);listeners.set(event,registered);
          },
          removeListener:(event,listener)=>listeners.get(event)?.delete(listener),
        };
        Object.defineProperty(window,"ethereum",{value:provider,configurable:true});
      }`});
      await page.setExtraHTTPHeaders({"x-connected-wallet":connectedWallet});
      const pending=new Map<string,{url:string;method:string;resourceType:string;startedAt:string}>();
      const requests:Array<Record<string,unknown>>=[];
      const consoleMessages:Array<Record<string,unknown>>=[];
      page.on("request",request=>{
        const entry={url:request.url(),method:request.method(),resourceType:request.resourceType(),
          connectedWallet:request.headers()["x-connected-wallet"]||null,startedAt:new Date().toISOString()};
        pending.set(request.url(),entry);requests.push({event:"started",...entry});
      });
      page.on("response",response=>requests.push({
        event:"response",url:response.url(),status:response.status(),at:new Date().toISOString(),
      }));
      page.on("requestfinished",request=>{
        pending.delete(request.url());requests.push({event:"finished",url:request.url(),at:new Date().toISOString()});
      });
      page.on("console",msg=>{
        const entry={route,viewport:viewport.name,type:msg.type(),text:msg.text()};
        consoleMessages.push(entry);
        if(msg.type()==="error")errors.push({...entry,type:"console"});
      });
      page.on("pageerror",error=>errors.push({route,viewport:viewport.name,type:"pageerror",text:error.stack||error.message}));
      page.on("requestfailed",request=>errors.push({route,viewport:viewport.name,type:"request",url:request.url(),error:request.failure()?.errorText}));
      let response;
      try {
        response=await page.goto(`http://127.0.0.1:3020/${route}`,{waitUntil:"networkidle"});
      } catch(error) {
        fs.writeFileSync(path.join(networkOutput,`${route.replaceAll("/","-")}-${viewport.name}.json`),JSON.stringify({
          route,viewport:viewport.name,pending:[...pending.values()],requests,console:consoleMessages,
          error:error instanceof Error?{name:error.name,message:error.message,stack:error.stack}:String(error),
        },null,2));
        await page.close();
        await context.close();
        await browser.close();
        await pool.end();
        throw error;
      }
      await page.screenshot({path:path.join(output,`${route.replaceAll("/","-")}-${viewport.name}.png`),fullPage:true});
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
      checks.push({route,viewport:viewport.name,width:viewport.width,height:viewport.height,status:response?.status(),overflow});
      if(!response?.ok()||overflow)errors.push({route,viewport:viewport.name,type:"page",status:response?.status(),overflow});
      await page.close();
    }
    await context.close();
  }
  fs.writeFileSync(path.resolve("evidence/local-e2e/browser-report.json"),JSON.stringify({routes,viewports,checks,errors},null,2));
  await browser.close();await pool.end();
  if(errors.length)throw new Error(`Local browser audit found ${errors.length} errors`);
}
main().catch(error=>{console.error(error);process.exitCode=1});
