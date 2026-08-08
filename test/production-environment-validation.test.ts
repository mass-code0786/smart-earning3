// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import deployment from "@/deployments/bsc-testnet.json";
const require = createRequire(import.meta.url);
const { validateProductionEnvironment } = require("../scripts/validate-production-environment.cjs");
const valid = { NODE_ENV:"production",DATABASE_URL:"postgresql://app:secret@db/live",DATABASE_SSL_MODE:"require",SESSION_SECRET:"s".repeat(64),APP_ORIGIN:"https://app.example.com",PORT:"3015",BSC_TESTNET_RPC_URL:"https://rpc.example.com",SMART_EARNING_CHAIN_ID:String(deployment.chainId),SMART_EARNING_CONTRACT_ADDRESS:deployment.address,BSC_TESTNET_USDT_ADDRESS:deployment.usdt,NEXT_PUBLIC_SMART_EARNING_CONTRACT_ADDRESS:deployment.address,NEXT_PUBLIC_BSC_TESTNET_USDT_ADDRESS:deployment.usdt,GENESIS_WALLET:deployment.genesis,TREASURY_WALLET:deployment.treasury,WITHDRAWAL_AUTHORIZER_ADDRESS:deployment.authorizer,ADMIN_WALLETS:"0x"+"4".repeat(40),SMART_EARNING_DEPLOYMENT_BLOCK:String(deployment.blockNumber) };
describe("production environment contract",()=>{
  it("accepts authoritative metadata assertions",()=>expect(validateProductionEnvironment(valid)).toMatchObject({valid:true,errors:[]}));
  it("accepts an omitted deployment-block assertion",()=>{const{SMART_EARNING_DEPLOYMENT_BLOCK:_,...withoutBlock}=valid;expect(validateProductionEnvironment(withoutBlock)).toMatchObject({valid:true,errors:[]})});
  it("rejects a conflicting deployment block",()=>expect(validateProductionEnvironment({...valid,SMART_EARNING_DEPLOYMENT_BLOCK:"1"}).errors).toContain("SMART_EARNING_DEPLOYMENT_BLOCK must match authoritative deployment metadata"));
  it("fails clearly for insecure critical values",()=>{const result=validateProductionEnvironment({...valid,DATABASE_URL:"http://db.example.com",SESSION_SECRET:"replace-with-secret",APP_ORIGIN:"http://localhost:3000",PORT:"3000",SMART_EARNING_CHAIN_ID:"31337"});const errors=result.errors.join(" ");expect(errors).toMatch(/DATABASE_URL/);expect(errors).toMatch(/SESSION_SECRET/);expect(errors).toMatch(/HTTPS/);expect(errors).toMatch(/3015/);expect(errors).toMatch(/deployment metadata/)});
  it("rejects development secrets",()=>{const result=validateProductionEnvironment({...valid,LOCAL_E2E:"true",X4_TEST_DATABASE_URL:"postgresql://test",DEPLOYER_PRIVATE_KEY:"secret"});expect(result.errors).toContain("LOCAL_E2E must not be set in production");expect(result.errors).toContain("X4_TEST_DATABASE_URL must not be set in production");expect(result.errors).toContain("DEPLOYER_PRIVATE_KEY must not be set in production")});
});
