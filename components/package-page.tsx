"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, Lock, PackageCheck, RefreshCw, Wallet } from "lucide-react";
import { formatTokenUnits, percentageBasisPoints } from "@/lib/client/money";
import { purchasePackageOnTestnet, walletLogin } from "@/lib/client/wallet";
import { presentBlockchainError } from "@/lib/client/blockchain-error";

type PackageItem = {
  packageId: number;
  name: string;
  priceTokenUnits: string;
  capAdditionTokenUnits: string;
  magicAllocationTokenUnits: string;
  status: "PURCHASED" | "AVAILABLE" | "LOCKED" | "PENDING" | "FAILED";
};
type PackageData = {
  wallet: string;
  registered: boolean;
  nextPackage: number;
  packages: PackageItem[];
  totalPackageValue: string;
  registrationValue: string;
  totalEligibleValue: string;
  totalEarningCap: string;
  totalEarned: string;
  remainingCap: string;
  cappingStatus: "ACTIVE" | "NEAR_CAP" | "CAPPED";
  modulePauses?: { packagePurchase: boolean; x3Placement: boolean; x4Placement: boolean };
};

const money = (value: string) => formatTokenUnits(value);

export function PackagePage({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<PackageData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(0);
  const [status, setStatus] = useState("");
  const [hash, setHash] = useState("");
  const submissionLock = useRef(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/packages", { cache: "no-store", credentials: "same-origin" });
      const body = typeof response.json === "function" ? await response.json() : JSON.parse(await response.text());
      if (!response.ok) throw new Error(body.error || "Package data unavailable");
      setData(body);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Package data unavailable");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function connect() {
    try {
      setStatus("Verifying wallet…");
      await walletLogin();
      await load();
      setStatus("Wallet verified");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Wallet verification failed");
    }
  }
  async function buy(item: PackageItem) {
    if (submissionLock.current) return;
    submissionLock.current = true;
    setBusy(item.packageId);
    setHash("");
    try {
      const result = await purchasePackageOnTestnet(item.packageId, BigInt(item.priceTokenUnits), (next, txHash) => {
        setStatus(next);
        if (txHash) setHash(txHash);
      });
      setHash(result.txHash);
      setStatus(`Package ${item.packageId} confirmed`);
      await load();
    } catch (reason) {
      setStatus(presentBlockchainError("Package purchase failed", reason, "Package purchase failed. Please try again."));
    } finally {
      submissionLock.current = false;
      setBusy(0);
    }
  }

  if (!data) return (
    <section className="smart-glass-card rounded-[22px] p-5">
      <AlertTriangle className="text-[#e9ad45]" />
      <p className="mt-3 text-sm">{error || "Loading package eligibility…"}</p>
      <div className="mt-4 flex gap-3">
        <button onClick={connect} className="flex items-center gap-2 text-xs text-[#00f77a]"><Wallet size={14} />Connect &amp; Sign</button>
        <button onClick={() => void load()} className="flex items-center gap-2 text-xs text-[#00f77a]"><RefreshCw size={14} />Retry</button>
      </div>
    </section>
  );

  const progress = percentageBasisPoints(data.totalEarned, data.totalEarningCap);
  const paused = Boolean(data.modulePauses?.packagePurchase || data.modulePauses?.x3Placement || data.modulePauses?.x4Placement);
  const pauseMessage = data.modulePauses?.packagePurchase ? "Package purchases are temporarily paused"
    : data.modulePauses?.x3Placement ? "Package purchases are paused while X3 placement is unavailable"
      : data.modulePauses?.x4Placement ? "Package purchases are paused while X4 placement is unavailable" : "";
  return (
    <div className="grid gap-4">
      <section className="smart-glass-card rounded-[22px] p-5">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            ["Current Package", data.nextPackage === 1 ? "Registration only" : `Package ${data.nextPackage ? data.nextPackage - 1 : 8}`],
            ["Next Package", data.nextPackage ? `Package ${data.nextPackage}` : "Maximum reached"],
            ["Total Package Purchase", money(data.totalPackageValue)],
            ["5X Earning Cap", money(data.totalEarningCap)],
            ["Capping Status", data.cappingStatus.replaceAll("_", " ")],
          ].map(([label, value]) => <span className="rounded-xl border border-[#00f77a]/10 bg-black/10 p-3" key={label}><small className="block text-[9px] text-[#8b9d94]">{label}</small><b className="mt-1 block text-sm">{value}</b></span>)}
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/5"><i className="block h-full bg-[#00f77a]" style={{ width: `${progress}%` }} /></div>
        <div className="mt-2 flex justify-between text-[9px] text-[#8b9d94]"><span>Earned {money(data.totalEarned)} · {progress.toFixed(2)}%</span><span>Remaining {money(data.remainingCap)}</span></div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><span>Registration Value (not capped) <b className="block">{money(data.registrationValue)}</b></span><span>Package Cap Principal <b className="block">{money(data.totalEligibleValue)}</b></span></div>
      </section>
      {paused && <section role="status" className="smart-glass-card rounded-[18px] border-[#e9ad45]/30 p-4 text-xs text-[#e9c47c]">{pauseMessage}</section>}
      {!data.registered && <section className="smart-glass-card rounded-[22px] border-[#e9ad45]/30 p-5"><h2 className="font-bold">Complete Registration First</h2><p className="mt-2 text-xs text-[#8b9d94]">Package purchases require confirmed on-chain registration.</p><Link href="/register" className="mt-4 inline-block rounded-xl bg-[#00f77a] px-4 py-3 text-xs font-bold text-black">Open Registration</Link></section>}
      <div className={`grid gap-3 ${compact ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
        {data.packages.map(item => <article className={`smart-glass-card rounded-[22px] p-5 ${item.status === "AVAILABLE" || item.status === "FAILED" ? "border-[#00f77a]/60" : ""}`} key={item.packageId}>
          <div className="flex items-center justify-between"><span className="text-xs text-[#8b9d94]">{item.name}</span><span className="rounded-full border border-[#00f77a]/20 px-2 py-1 text-[8px]">{item.status}</span></div>
          <b className="mt-4 block text-3xl">{money(item.priceTokenUnits)}</b>
          <div className="mt-4 grid gap-2 text-[10px] text-[#8b9d94]"><span>5X cap addition <b className="float-right text-white">{money(item.capAdditionTokenUnits)}</b></span><span>Magic accounting (12.5%) <b className="float-right text-white">{item.magicAllocationTokenUnits ? money(item.magicAllocationTokenUnits) : "Backend pending"}</b></span><span>Serial purchase <b className="float-right text-white">Required</b></span></div>
          <button disabled={paused || !data.registered || !["AVAILABLE", "FAILED"].includes(item.status) || busy > 0} onClick={() => void buy(item)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-[#00f77a]/20 bg-[#00f77a]/10 p-3 text-xs font-bold text-[#00f77a] disabled:border-white/5 disabled:bg-white/[.02] disabled:text-[#60756a]">
            {item.status === "PURCHASED" ? <><PackageCheck size={15} />Purchased</> : item.status === "PENDING" ? "Pending…" : item.status === "AVAILABLE" || item.status === "FAILED" ? busy === item.packageId ? "Pending…" : `${item.status === "FAILED" ? "Retry" : "Buy"} ${money(item.priceTokenUnits)} USDT` : <><Lock size={14} />Locked</>}
          </button>
        </article>)}
      </div>
      {status && <section className="smart-glass-card min-w-0 max-w-full overflow-hidden rounded-[18px] p-4 text-xs"><p role="status" className="max-h-28 overflow-y-auto [overflow-wrap:anywhere] [word-break:break-word]">{status}</p>{hash && <a href={`${process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noreferrer" className="mt-2 flex min-w-0 max-w-full items-center gap-2 break-all text-[#00f77a]"><ExternalLink className="shrink-0" size={13} /><span className="min-w-0 break-all">{hash}</span></a>}</section>}
      <p className="text-[10px] text-[#8b9d94]">The unified contract records the 12.5% Magic accounting allocation and forwards the full package payment to treasury atomically.</p>
    </div>
  );
}

export function PackageCapDashboard() { return <PackagePage compact />; }
