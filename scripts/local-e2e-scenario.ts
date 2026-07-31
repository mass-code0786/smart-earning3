import fs from "node:fs";
import path from "node:path";
import { Contract, ContractFactory, JsonRpcProvider, keccak256, toUtf8Bytes } from "ethers";
import { verifyAndActivateRegistration } from "../lib/server/registration-service";
import { verifyPackagePurchase } from "../lib/server/package-service";
import { verifyBoosterTopUp } from "../lib/server/booster-service";
import { creditGrossEarning } from "../lib/server/earning-split-service";
import { getPool, transaction } from "../lib/server/db";
import { runDatabaseReconciliation } from "../lib/server/operations-service";

const RPC="http://127.0.0.1:8545",DOLLAR=1_000_000n;
const artifact=(name:string)=>JSON.parse(fs.readFileSync(path.resolve(`artifacts/contracts/${name==="MockUSDT"?"test/MockUSDT.sol":"SmartEarning.sol"}/${name}.json`),"utf8"));
const ref=(value:string)=>keccak256(toUtf8Bytes(value));
const settle=async(provider:JsonRpcProvider)=>{await provider.send("hardhat_mine",["0x2"]);await new Promise(r=>setTimeout(r,1_000))};
async function reverted(action:()=>Promise<unknown>){try{await action();return false}catch{return true}}

async function main(){
  if(process.env.LOCAL_E2E!=="true"||Number(process.env.SMART_EARNING_CHAIN_ID)!==31337)
    throw new Error("Local E2E refuses to run outside chain 31337");
  const provider=new JsonRpcProvider(RPC,31337,{staticNetwork:true});
  const signers=await Promise.all(Array.from({length:9},(_,i)=>provider.getSigner(i)));
  const[admin,genesis,treasury,keeper,userA,userB,userC,executor,authorizer]=signers;
  const addresses=await Promise.all(signers.map(s=>s.getAddress()));
  const token:any=await new ContractFactory(artifact("MockUSDT").abi,artifact("MockUSDT").bytecode,admin).deploy();
  await token.waitForDeployment();
  const smart:any=await new ContractFactory(artifact("SmartEarning").abi,artifact("SmartEarning").bytecode,admin)
    .deploy(await token.getAddress(),addresses[1],addresses[0],addresses[2],addresses[8]);
  await smart.waitForDeployment();
  const tokenAddress=await token.getAddress(),smartAddress=await smart.getAddress();
  const smartDeployment=await smart.deploymentTransaction()?.wait();
  if(!smartDeployment)throw new Error("Smart Earning deployment receipt missing");
  const localDeploymentMetadata=JSON.stringify({
    chainId:31337,address:smartAddress,txHash:smartDeployment.hash,
    blockNumber:smartDeployment.blockNumber,genesis:addresses[1],
  });
  const keeperRole=await smart.KEEPER_ROLE(),executorRole=await smart.WITHDRAWAL_EXECUTOR_ROLE();
  await(await smart.grantRole(keeperRole,addresses[3])).wait();
  await(await smart.grantRole(executorRole,addresses[7])).wait();
  for(const signer of[userA,userB,userC,treasury]){
    await(await token.mint(await signer.getAddress(),10_000n*DOLLAR)).wait();
    await(await token.connect(signer).approve(smartAddress,10_000n*DOLLAR)).wait();
  }
  Object.assign(process.env,{
    SMART_EARNING_CONTRACT_ADDRESS:smartAddress,BSC_TESTNET_USDT_ADDRESS:tokenAddress,
    NEXT_PUBLIC_SMART_EARNING_CONTRACT_ADDRESS:smartAddress,NEXT_PUBLIC_BSC_TESTNET_USDT_ADDRESS:tokenAddress,
    SMART_EARNING_DEPLOYMENT_BLOCK:String(smartDeployment.blockNumber),
    LOCAL_E2E_DEPLOYMENT_METADATA:localDeploymentMetadata,
    GENESIS_WALLET:addresses[1],TREASURY_WALLET:addresses[2],CONFIRMATIONS_REQUIRED:"1",
  });
  const treasuryStart=BigInt(await token.balanceOf(addresses[2]));
  const registerA=await(await smart.connect(userA).register(addresses[1])).wait();
  if(!registerA)throw new Error("User A registration receipt missing");
  const registrationMagic=(await smart.magicBalance(addresses[4])).toString();
  const treasuryAfterRegistration=BigInt(await token.balanceOf(addresses[2]));
  await settle(provider);
  await verifyAndActivateRegistration(addresses[4],registerA.hash);
  const packageA=await(await smart.connect(userA).purchasePackage(1,8n*DOLLAR)).wait();
  if(!packageA)throw new Error("Package receipt missing");
  const treasuryAfterPackage=BigInt(await token.balanceOf(addresses[2]));
  await settle(provider);
  await verifyPackagePurchase(addresses[4],packageA.hash);
  const registerB=await(await smart.connect(userB).register(addresses[4])).wait();
  if(!registerB)throw new Error("User B registration receipt missing");
  await settle(provider);
  await verifyAndActivateRegistration(addresses[5],registerB.hash);
  const boosterSource=ref("LOCAL:E2E:BOOSTER:A");
  const booster=await(await smart.connect(userA).topupBooster(5n*DOLLAR,boosterSource)).wait();
  if(!booster)throw new Error("Booster receipt missing");
  const treasuryAfterBooster=BigInt(await token.balanceOf(addresses[2]));
  await settle(provider);
  await verifyBoosterTopUp(addresses[4],booster.hash,5n*DOLLAR);
  const dbUser=(await getPool().query<{id:string}>("SELECT id FROM users WHERE wallet_address=lower($1)",[addresses[4]])).rows[0];
  await transaction(c=>creditGrossEarning({userId:dbUser.id,incomeType:"DIRECT_INCOME",
    sourceReference:"local-e2e-withdrawable",grossAmount:1_111_112n,idempotencyKey:"local:e2e:earning",
    magicAlreadyOnchain:true},c));
  const withdrawal=(await getPool().query<{id:string;gross_reserved:string;fee_amount:string;net_payout:string}>(
    "SELECT id,gross_reserved::text,fee_amount::text,net_payout::text FROM auto_withdrawals WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
    [dbUser.id])).rows[0];
  if(!withdrawal)throw new Error("Automatic withdrawal reservation was not created");
  const withdrawalId="0x"+withdrawal.id.replaceAll("-","").padEnd(64,"0");
  const liquiditySource=ref("LOCAL:E2E:LIQUIDITY:A");
  await(await smart.connect(treasury).fundWithdrawalLiquidity(withdrawal.net_payout,liquiditySource)).wait();
  const issuedAt=BigInt(Math.floor(Date.now()/1000)),authorization={payoutType:ref("LEDGER_WITHDRAWAL"),
    reservationId:withdrawalId,earningSource:ref(`AUTO_WITHDRAWAL:${withdrawal.id}`),user:addresses[4],
    chainId:31337n,verifyingContract:smartAddress,grossAmount:BigInt(withdrawal.gross_reserved),
    feeAmount:BigInt(withdrawal.fee_amount),netAmount:BigInt(withdrawal.net_payout),destination:addresses[4],
    issuedAt,nonce:0n,deadline:issuedAt+30n*24n*60n*60n};
  const authorizationTypes={WithdrawalAuthorization:[
    {name:"payoutType",type:"bytes32"},{name:"reservationId",type:"bytes32"},{name:"earningSource",type:"bytes32"},
    {name:"user",type:"address"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"},
    {name:"grossAmount",type:"uint256"},{name:"feeAmount",type:"uint256"},{name:"netAmount",type:"uint256"},
    {name:"destination",type:"address"},{name:"issuedAt",type:"uint256"},{name:"nonce",type:"uint256"},{name:"deadline",type:"uint256"}]};
  const authorizationSignature=await authorizer.signTypedData(
    {name:"SmartEarning",version:"1",chainId:31337,verifyingContract:smartAddress},authorizationTypes,authorization);
  const payout=await(await smart.connect(executor).executeWithdrawal(authorization,authorizationSignature)).wait();
  if(!payout)throw new Error("Withdrawal receipt missing");
  await getPool().query("UPDATE auto_withdrawals SET status='CONFIRMED',tx_hash=$2,updated_at=now() WHERE id=$1",
    [withdrawal.id,payout.hash]);
  const invalidSource="0x"+"00".repeat(32);
  const failures={
    duplicateRegistration:await reverted(async()=>{await(await smart.connect(userA).register(addresses[1])).wait()}),
    duplicatePackage:await reverted(async()=>{await(await smart.connect(userA).purchasePackage(1,8n*DOLLAR)).wait()}),
    duplicateBooster:await reverted(async()=>{await(await smart.connect(userA).topupBooster(5n*DOLLAR,boosterSource)).wait()}),
    duplicateWithdrawal:await reverted(async()=>{await(await smart.connect(executor).executeWithdrawal(authorization,authorizationSignature)).wait()}),
    invalidReferral:await reverted(async()=>{await(await smart.connect(userC).register(addresses[6])).wait()}),
    invalidPackage:await reverted(async()=>{await(await smart.connect(userB).purchasePackage(2,16n*DOLLAR)).wait()}),
    invalidSourceReference:await reverted(async()=>{await(await smart.connect(userA).topupBooster(DOLLAR,invalidSource)).wait()}),
    wrongSigner:await reverted(async()=>{await(await smart.connect(userA).executeWithdrawal(authorization,authorizationSignature)).wait()}),
  };
  const reconciliation=await runDatabaseReconciliation(addresses[1].toLowerCase());
  const report={
    localOnly:true,chainId:31337,rpc:RPC,addresses:{mockUsdt:tokenAddress,smartEarning:smartAddress,
      admin:addresses[0],genesis:addresses[1],treasury:addresses[2],keeper:addresses[3],
      userA:addresses[4],userB:addresses[5],userC:addresses[6],withdrawalExecutor:addresses[7],withdrawalAuthorizer:addresses[8]},
    transactions:{registerA:registerA.hash,packageA:packageA.hash,registerB:registerB.hash,
      boosterTopUp:booster.hash,withdrawal:payout.hash},
    checks:{registrationMagic,
      packageOwned:await smart.hasPurchasedPackage(addresses[4],1),earningCap:(await smart.totalEarningCap(addresses[4])).toString(),
      sponsorOfB:await smart.sponsorOf(addresses[5]),
      treasuryForwarding:{registration:(treasuryAfterRegistration-treasuryStart).toString(),
        package:(treasuryAfterPackage-treasuryAfterRegistration).toString(),
        booster:(treasuryAfterBooster-treasuryAfterPackage-2n*DOLLAR).toString()},
      contractUsdtBalance:(await token.balanceOf(smartAddress)).toString(),withdrawal,failures,
      reconciliation:{scanned:reconciliation.scanned.toString(),mismatched:reconciliation.mismatched.toString()}},
  };
  fs.mkdirSync(path.resolve("evidence/local-e2e"),{recursive:true});
  fs.writeFileSync(path.resolve("evidence/local-e2e/report.json"),JSON.stringify(report,null,2));
  fs.writeFileSync(path.resolve("evidence/local-e2e/runtime.env"),
    [`LOCAL_E2E=true`,`SMART_EARNING_CHAIN_ID=31337`,`BSC_TESTNET_RPC_URL=${RPC}`,
      `BSC_TESTNET_USDT_ADDRESS=${tokenAddress}`,`SMART_EARNING_CONTRACT_ADDRESS=${smartAddress}`,
      `SMART_EARNING_DEPLOYMENT_BLOCK=${smartDeployment.blockNumber}`,
      `LOCAL_E2E_DEPLOYMENT_METADATA=${localDeploymentMetadata}`,
      `TREASURY_WALLET=${addresses[2]}`,`GENESIS_WALLET=${addresses[1]}`,
      `NEXT_PUBLIC_BSC_TESTNET_USDT_ADDRESS=${tokenAddress}`,
      `NEXT_PUBLIC_SMART_EARNING_CONTRACT_ADDRESS=${smartAddress}`,
      `NEXT_PUBLIC_SMART_EARNING_CHAIN_ID=31337`,`NEXT_PUBLIC_NETWORK_NAME=Hardhat Local`,
    ].join("\n")+"\n");
  console.log(JSON.stringify(report,null,2));
  await getPool().end();
}
main().catch(async error=>{console.error(error);await getPool().end().catch(()=>undefined);process.exitCode=1});
