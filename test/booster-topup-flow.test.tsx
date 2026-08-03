import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoosterPage } from "@/components/booster-page";
import { boosterAmountTokenUnits, normalizeBoosterAmountInput } from "@/lib/client/booster-topup";

const{topUp}=vi.hoisted(()=>({topUp:vi.fn()}));
vi.mock("@/lib/client/wallet",()=>({topUpBoosterWalletOnTestnet:topUp}));

const dashboard={
 balance:"5000000",package_credits:"5000000",manual_top_ups:"0",refunds:"0",deductions:"0",
 nextEntryAt:null,server_time:"2026-07-28T10:00:00Z",next_entry_at:null,booster_wallet_balance:"5000000",
 eligibility:"INACTIVE",status:"INACTIVE",boosterActive:false,lastRunAt:null,nextEligibleAt:null,remainingSeconds:0,
 active_entries:0,completed_entries:0,total_entries:0,pending_positions:0,total_income:"0",
 entries:[],walletHistory:[],entryHistory:[],topUpHistory:[],
};
function responses(available="100000000"){
 return vi.fn(async(input:string,init?:RequestInit)=>{
  if(input==="/api/booster/top-up/prepare"){
   const amount=BigInt(JSON.parse(String(init?.body)).amountTokenUnits);
   if(amount>BigInt(available))return{ok:false,json:async()=>({error:"Top-up amount exceeds available USDT balance"})};
   return{ok:true,json:async()=>({amountTokenUnits:amount.toString(),availableBalanceTokenUnits:available,network:"BNB Smart Chain Testnet",chainId:97,gasCurrency:"tBNB"})};
  }
  return{ok:true,json:async()=>dashboard};
 });
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()});
beforeEach(()=>{vi.clearAllMocks();topUp.mockResolvedValue({topUpId:"1",duplicate:false})});

describe("custom Booster top-up amounts",()=>{
 it("accepts $2.50, $5 and a six-decimal custom amount",()=>{
  expect(boosterAmountTokenUnits("2.50")).toBe(2_500_000n);
  expect(boosterAmountTokenUnits("5")).toBe(5_000_000n);
  expect(boosterAmountTokenUnits("1.234567")).toBe(1_234_567n);
  expect(normalizeBoosterAmountInput("0005.250000")).toBe("5.250000");
 });
 it("rejects zero, negative, text and excess decimal precision",()=>{
  expect(()=>boosterAmountTokenUnits("0")).toThrow("greater than zero");
  expect(normalizeBoosterAmountInput("-1")).toBeNull();
  expect(normalizeBoosterAmountInput("hello")).toBeNull();
  expect(normalizeBoosterAmountInput("1.1234567")).toBeNull();
 });
 it("prepares before approval, confirms exact amount once, then refreshes balances",async()=>{
  const fetchMock=responses();vi.stubGlobal("fetch",fetchMock);render(<BoosterPage/>);
  await screen.findByText("Booster Wallet top-up");
  fireEvent.click(screen.getByRole("button",{name:"$5"}));fireEvent.click(screen.getByRole("button",{name:"Add Funds"}));
  expect(await screen.findByRole("dialog",{name:"Confirm Booster top-up"})).toBeInTheDocument();
  expect(screen.getByText("$10.00 USDT")).toBeInTheDocument();
  const confirm=screen.getByRole("button",{name:"Confirm"});fireEvent.click(confirm);fireEvent.click(confirm);
  await waitFor(()=>expect(topUp).toHaveBeenCalledTimes(1));
  expect(topUp).toHaveBeenCalledWith(5_000_000n,expect.any(Function));
  await waitFor(()=>expect(fetchMock.mock.calls.filter(([url])=>url==="/api/booster").length).toBeGreaterThan(1));
 });
 it("rejects an amount above available balance before wallet approval",async()=>{
  vi.stubGlobal("fetch",responses("4000000"));render(<BoosterPage/>);await screen.findByText("Booster Wallet top-up");
  fireEvent.change(screen.getByPlaceholderText("0.00"),{target:{value:"5"}});fireEvent.click(screen.getByRole("button",{name:"Add Funds"}));
  expect(await screen.findByText("Top-up amount exceeds available USDT balance")).toBeInTheDocument();
  expect(topUp).not.toHaveBeenCalled();
 });
 it.each(["User rejected approval","User rejected Booster top-up transaction"])("surfaces wallet rejection: %s",async(message)=>{
  vi.spyOn(console,"error").mockImplementation(()=>undefined);
  vi.stubGlobal("fetch",responses());topUp.mockRejectedValueOnce(new Error(message));render(<BoosterPage/>);await screen.findByText("Booster Wallet top-up");
  fireEvent.click(screen.getByRole("button",{name:"$2.50"}));fireEvent.click(screen.getByRole("button",{name:"Add Funds"}));
  fireEvent.click(await screen.findByRole("button",{name:"Confirm"}));
  expect(await screen.findByText("Transaction was rejected in your wallet.")).toBeInTheDocument();
 });
});
