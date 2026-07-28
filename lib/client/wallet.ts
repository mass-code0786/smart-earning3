"use client";

import { BrowserProvider, Contract, Eip1193Provider, parseUnits, keccak256, toUtf8Bytes } from "ethers";
import { ERC20_ABI, PACKAGE_ABI, SMART_EARNING_ABI } from "@/lib/blockchain/abi";

export type InjectedProvider = Eip1193Provider & {
  providers?: InjectedProvider[];
  isTokenPocket?: boolean;
};

declare global {
  interface Window {
    ethereum?: InjectedProvider;
    tokenpocket?: { ethereum?: InjectedProvider };
  }
}

export type WalletLoginCode =
  | "WALLET_MISSING" | "WALLET_REJECTED" | "WRONG_NETWORK" | "PROVIDER_ERROR"
  | "NONCE_FAILED" | "SIGNATURE_REJECTED" | "VERIFY_FAILED" | "SESSION_FAILED"
  | "SERVER_CONFIG_INCOMPLETE" | "NETWORK_ERROR";

export class WalletLoginError extends Error {
  constructor(public readonly code: WalletLoginCode, message: string) {
    super(message);
    this.name = "WalletLoginError";
  }
}

const TESTNET = {
  chainId: "0x61",
  chainName: "BNB Smart Chain Testnet",
  nativeCurrency: { name: "Test BNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: ["https://data-seed-prebsc-1-s1.bnbchain.org:8545"],
  blockExplorerUrls: ["https://testnet.bscscan.com"],
};

function publicContracts() {
  const app = process.env.NEXT_PUBLIC_SMART_EARNING_CONTRACT_ADDRESS;
  const usdt = process.env.NEXT_PUBLIC_BSC_TESTNET_USDT_ADDRESS;
  const packages = process.env.NEXT_PUBLIC_SMART_EARNING_CONTRACT_ADDRESS;
  if (!app || !usdt || !packages) throw new Error("BNB Testnet contract addresses are not configured");
  return { app, usdt, packages };
}

export async function purchasePackageOnTestnet(
  packageId: number,
  amountTokenUnits: bigint,
  onStatus: (status: string, hash?: string) => void,
) {
  const { signer, wallet } = await connectTestnet();
  const { usdt, packages } = publicContracts();
  const provider = signer.provider;
  const token = new Contract(usdt, ERC20_ABI, signer);
  const packageContract = new Contract(packages, PACKAGE_ABI, signer);
  const [balance, gasBalance, nextPackage, purchased] = await Promise.all([
    token.balanceOf(wallet), provider.getBalance(wallet),
    packageContract.getNextPackage(wallet), packageContract.hasPurchasedPackage(wallet, packageId),
  ]);
  if (Boolean(purchased)) throw new Error("Package has already been purchased");
  if (Number(nextPackage) !== packageId) throw new Error(`Package ${Number(nextPackage)} must be purchased next`);
  if (BigInt(balance) < amountTokenUnits) throw new Error("Insufficient USDT balance");
  if (BigInt(gasBalance) === 0n) throw new Error("Insufficient BNB for gas");

  const allowance = BigInt(await token.allowance(wallet, packages));
  if (allowance < amountTokenUnits) {
    const fee=await provider.getFeeData();
    const approvalGas=await token.approve.estimateGas(packages,amountTokenUnits);
    const approvalCost=approvalGas*BigInt(fee.maxFeePerGas||fee.gasPrice||0);
    if(BigInt(gasBalance)<approvalCost)throw new Error("Insufficient BNB for approval gas");
    onStatus("Confirm exact USDT approval. BNB gas is separate.");
    const approval = await token.approve(packages, amountTokenUnits);
    await approval.wait();
  }
  const fee=await provider.getFeeData();
  const purchaseGas=await packageContract.purchasePackage.estimateGas(packageId,amountTokenUnits);
  const purchaseCost=purchaseGas*BigInt(fee.maxFeePerGas||fee.gasPrice||0);
  if(BigInt(await provider.getBalance(wallet))<purchaseCost)throw new Error("Insufficient BNB for package gas");
  onStatus("Confirm package purchase. BNB gas is charged separately.");
  let sent = await packageContract.purchasePackage(packageId, amountTokenUnits);
  onStatus("Package transaction pending", sent.hash);
  try {
    await Promise.race([
      sent.wait(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Confirmation timeout; transaction remains pending")), 180_000)),
    ]);
  } catch (error) {
    const replacement = error as { code?:string; replacement?:typeof sent; cancelled?:boolean };
    if (replacement.code === "TRANSACTION_REPLACED" && replacement.replacement && !replacement.cancelled) {
      sent = replacement.replacement;
      await sent.wait();
    } else throw error;
  }
  onStatus("Confirming purchase with backend", sent.hash);
  for(let attempt=0;attempt<12;attempt++){
    const response = await fetch("/api/packages/verify", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ txHash: sent.hash }),
    });
    const result = await response.json();
    if(response.ok)return{...result,txHash:sent.hash};
    if(!["CONFIRMATIONS_PENDING","TX_PENDING"].includes(result.code)){
      throw new Error(result.error||"Package indexing failed");
    }
    onStatus("Waiting for required confirmations",sent.hash);
    await new Promise(resolve=>setTimeout(resolve,5_000));
  }
  throw new Error("Backend indexing delay; transaction remains verifiable on BscScan");
}

export async function topUpBoosterWalletOnTestnet(
  amountTokenUnits:bigint,onStatus:(status:string,hash?:string)=>void,
){
  if(amountTokenUnits<=0n)throw new Error("Enter a valid Booster Wallet amount");
  const{signer,wallet}=await connectTestnet(),{usdt,packages}=publicContracts();
  const token=new Contract(usdt,ERC20_ABI,signer),provider=signer.provider;
  if(BigInt(await token.balanceOf(wallet))<amountTokenUnits)throw new Error("Insufficient USDT balance");
  if(BigInt(await provider.getBalance(wallet))===0n)throw new Error("Insufficient BNB for gas");
  onStatus("Approve Booster Wallet top-up");
  await(await token.approve(packages,amountTokenUnits)).wait();
  const platform=new Contract(packages,["function topupBooster(uint256 amount,bytes32 sourceReference)"],signer);
  const source=keccak256(toUtf8Bytes(`BOOSTER_TOP_UP:${wallet}:${Date.now()}`));
  onStatus("Confirm Booster Wallet top-up");
  const sent=await platform.topupBooster(amountTokenUnits,source);onStatus("Booster Wallet top-up pending",sent.hash);
  await sent.wait();onStatus("Verifying Booster Wallet top-up",sent.hash);
  for(let attempt=0;attempt<12;attempt++){
    const response=await fetch("/api/booster/top-up",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({txHash:sent.hash,amountTokenUnits:amountTokenUnits.toString()})});
    const body=await response.json();if(response.ok)return{...body,txHash:sent.hash};
    if(!["CONFIRMATIONS_PENDING","TX_PENDING"].includes(body.code))throw new Error(body.error||"Booster Wallet top-up verification failed");
    await new Promise(resolve=>setTimeout(resolve,5_000));
  }
  throw new Error("Booster Wallet top-up remains pending verification");
}

export async function connectTestnet() {
  const injected = getInjectedProvider();
  try {
    await injected.request({ method: "eth_requestAccounts" });
  } catch (error) {
    if (isWalletRejection(error)) throw new WalletLoginError("WALLET_REJECTED", "Wallet connection rejected");
    throw new WalletLoginError("PROVIDER_ERROR", "Wallet provider could not connect");
  }
  let chainId: unknown;
  try {
    chainId = await injected.request({ method: "eth_chainId" });
  } catch {
    throw new WalletLoginError("PROVIDER_ERROR", "Wallet provider could not read the current network");
  }
  const expectedChainId=Number(process.env.NEXT_PUBLIC_SMART_EARNING_CHAIN_ID||97);
  if (normalizeChainId(chainId) !== expectedChainId) {
    throw new WalletLoginError("WRONG_NETWORK", process.env.NEXT_PUBLIC_NETWORK_NAME
      ?`Switch to ${process.env.NEXT_PUBLIC_NETWORK_NAME}`:"Switch to BNB Smart Chain Testnet");
  }
  const provider = new BrowserProvider(injected);
  const signer = await provider.getSigner();
  return { signer, wallet: (await signer.getAddress()).toLowerCase() };
}

export function getInjectedProvider(target: Pick<Window, "ethereum" | "tokenpocket"> = window) {
  const standard = target.ethereum;
  const providers = standard?.providers?.filter(Boolean);
  const provider = providers?.find((item) => item.isTokenPocket)
    || providers?.[0]
    || standard
    || target.tokenpocket?.ethereum;
  if (!provider) throw new WalletLoginError("WALLET_MISSING", "Wallet not detected");
  return provider;
}

function normalizeChainId(value: unknown) {
  if (typeof value === "string" && /^0x[0-9a-f]+$/i.test(value)) return Number.parseInt(value, 16);
  if (typeof value === "number") return value;
  return Number.NaN;
}

function errorCode(error: unknown) {
  return (error as { code?: number | string })?.code;
}

function isWalletRejection(error: unknown) {
  return errorCode(error) === 4001 || errorCode(error) === "ACTION_REJECTED";
}

export async function switchToTestnet() {
  const provider = getInjectedProvider();
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: TESTNET.chainId }] });
  } catch (error) {
    if (errorCode(error) === 4902) {
      await provider.request({ method: "wallet_addEthereumChain", params: [TESTNET] });
      return;
    }
    if (isWalletRejection(error)) throw new WalletLoginError("WALLET_REJECTED", "Network switch rejected");
    throw new WalletLoginError("PROVIDER_ERROR", "Wallet could not switch networks");
  }
}

async function authRequest(path: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(path, body === undefined ? { cache: "no-store" } : {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new WalletLoginError("NETWORK_ERROR", "Network request failed");
  }
  let result: Record<string, unknown> = {};
  try { result = await response.json(); } catch { /* use a safe stage-specific error */ }
  return { response, result };
}

export async function walletLogin() {
  const { signer, wallet } = await connectTestnet();
  const nonceCall = await authRequest("/api/auth/nonce", { wallet });
  if (!nonceCall.response.ok) {
    if (nonceCall.result.code === "SERVER_CONFIG_INCOMPLETE") {
      throw new WalletLoginError("SERVER_CONFIG_INCOMPLETE", "Server configuration incomplete");
    }
    throw new WalletLoginError("NONCE_FAILED", "Could not request login nonce");
  }
  const nonce = nonceCall.result as { nonce?: string; message?: string };
  if (!nonce.nonce || !nonce.message) throw new WalletLoginError("NONCE_FAILED", "Could not request login nonce");
  let signature: string;
  try {
    signature = await signer.signMessage(nonce.message);
  } catch (error) {
    if (isWalletRejection(error)) throw new WalletLoginError("SIGNATURE_REJECTED", "Signature rejected");
    throw new WalletLoginError("PROVIDER_ERROR", "Wallet provider could not sign the login message");
  }
  const verification = await authRequest("/api/auth/verify", { wallet, nonce: nonce.nonce, signature });
  if (!verification.response.ok) {
    if (verification.result.code === "SERVER_CONFIG_INCOMPLETE") {
      throw new WalletLoginError("SERVER_CONFIG_INCOMPLETE", "Server configuration incomplete");
    }
    throw new WalletLoginError("VERIFY_FAILED", "Signature verification failed");
  }
  const session = await authRequest("/api/auth/session");
  if (!session.response.ok) throw new WalletLoginError("SESSION_FAILED", "Session could not be created");
  const result = session.result as {
    wallet: string;
    chainId: number;
    registered?: boolean;
    registrationStatus?: string | null;
  };
  return {
    ...result,
    wallet: result.wallet.toLowerCase(),
    registered: result.registered === true || result.registrationStatus === "ACTIVE",
  };
}

export async function registerOnTestnet(sponsor: string, onStatus: (status: string) => void) {
  const { signer, wallet } = await connectTestnet();
  onStatus("Finding placement…");
  const preparationStorageKey = `registration-preparation:${wallet}:${sponsor.toLowerCase()}`;
  let requestKey = sessionStorage.getItem(preparationStorageKey);
  if (!requestKey) {
    requestKey = crypto.randomUUID();
    sessionStorage.setItem(preparationStorageKey, requestKey);
  }
  const preparation = await fetch("/api/registrations/prepare", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sponsor, requestKey }),
  });
  const placement = await preparation.json();
  if (preparation.status === 409 && placement.code === "ALREADY_REGISTERED") {
    sessionStorage.removeItem(preparationStorageKey);
    return { alreadyRegistered: true as const };
  }
  if (!preparation.ok) throw new Error(placement.error || "Could not find matrix placement");
  const { app, usdt } = publicContracts();
  const token = new Contract(usdt, ERC20_ABI, signer);
  const registration = new Contract(app, SMART_EARNING_ABI, signer);
  const price = parseUnits("2", Number(await token.decimals()));
  if (BigInt(await token.allowance(wallet, app)) < price) {
    onStatus("Approve exactly 2 USDT. BNB gas is charged separately.");
    await (await token.approve(app, price)).wait();
  }
  onStatus("Confirm registration. Your wallet will show the separate BNB gas fee.");
  const sent = await registration.register(sponsor);
  sessionStorage.removeItem(preparationStorageKey);
  onStatus(`Submitted ${sent.hash}. Waiting for confirmation…`);
  await sent.wait();
  const response = await fetch("/api/registrations/verify", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ txHash: sent.hash }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Backend verification failed");
  return { ...result, txHash: sent.hash, alreadyRegistered: false as const };
}
