"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, GitBranch, Lock, RefreshCw, RotateCw } from "lucide-react";
import { MatrixHistoryMenu } from "@/components/matrix-history-menu";

type Slot = { slotNumber: number; wallet: string; placementType: string };
type X3Package = {
  packageId: number;
  priceTokenUnits: string;
  x3Allocation: string;
  active: boolean;
  permanentSponsor: string | null;
  matrixParent: string | null;
  currentCycle: number;
  slots: Slot[];
  earnedIncome: string;
  heldIncome: string;
  releasedIncome: string;
  recycleCount: number;
};

const units = (value: string) => {
  const amount = BigInt(value);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `$${whole}.${fraction}`;
};
const wallet = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

export function X3Page() {
  const [data, setData] = useState<X3Package[] | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/x3/packages", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "X3 data unavailable");
      setData(body.packages);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "X3 data unavailable");
    }
  }

  useEffect(() => { void load(); }, []);

  if (!data) {
    return <section className="smart-glass-card p-5">
      <AlertTriangle className="text-[#e9ad45]" />
      <p className="mt-3 text-sm">{error || "Loading package X3 matrices…"}</p>
      <button onClick={() => void load()} className="mt-3 flex items-center gap-2 text-xs text-[#00f77a]">
        <RefreshCw size={14} />Retry
      </button>
    </section>;
  }

  return <div className="grid gap-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {data.map((item) => <article className="smart-glass-card matrix-history-host rounded-[22px] p-5" key={item.packageId}><MatrixHistoryMenu module="X3" packageId={item.packageId} title={`Package ${item.packageId} X3 Matrix`}/>
        <div className="flex items-center justify-between">
          <b>Package {item.packageId} · {units(item.priceTokenUnits)}</b>
          <span className={`rounded-full border px-2 py-1 text-[9px] ${item.active ? "border-[#00f77a]/30 text-[#00f77a]" : "border-white/10 text-[#8b9d94]"}`}>
            {item.active ? "ACTIVE" : "LOCKED"}
          </span>
        </div>
        <p className="mt-2 text-xs text-[#8b9d94]">X3 allocation <strong className="text-white">{units(item.x3Allocation)}</strong></p>
        <div className="mt-4 grid grid-cols-3 gap-2" aria-label={`Package ${item.packageId} X3 structure`}>
          {[1, 2, 3].map((position) => {
            const slot = item.slots.find((value) => value.slotNumber === position);
            return <span className={`rounded-xl border p-3 text-center text-[9px] ${slot ? "border-[#00f77a]/30 bg-[#00f77a]/5" : "border-dashed border-white/10"}`} key={position}>
              <b className="block">Slot {position}</b>
              <small className="mt-1 block truncate text-[#8b9d94]">{slot ? wallet(slot.wallet) : "Empty"}</small>
              <em className="not-italic text-[#00f77a]">{slot?.placementType || "—"}</em>
            </span>;
          })}
        </div>
        <div className="mt-4 grid gap-1 text-[10px] text-[#8b9d94]">
          <Stat label="Sponsor" value={item.permanentSponsor || "Genesis"} />
          <Stat label="Matrix parent" value={item.matrixParent || "Not placed"} />
          <Stat label="Current cycle number" value={`#${item.currentCycle}`} />
          <Stat label="Current cycle status" value={item.active ? "ACTIVE" : "LOCKED"} />
          <Stat label="Filled positions / total positions" value={`${item.slots.length} / 3`} />
          <Stat label="Total earning" value={`${units(item.earnedIncome)} USDT`} accent />
          <Stat label="Recycled" value={`${item.recycleCount} times ♻️`} />
          <Stat label="Held" value={units(item.heldIncome)} warning />
          <Stat label="Released" value={units(item.releasedIncome)} />
        </div>
        {!item.active && item.heldIncome !== "0"
          ? <p className="mt-3 text-[10px] text-[#e9ad45]">Activate this package to release your held X3 income.</p>
          : null}
        {item.active
          ? <Link href="/packages" className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-[#00f77a]/20 bg-[#00f77a]/10 p-3 text-xs text-[#00f77a]"><GitBranch size={14} />Package matrix active</Link>
          : <Link href="/packages" className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-[#00f77a]/20 bg-[#00f77a]/10 p-3 text-xs text-[#00f77a]"><Lock size={14} />Upgrade / Buy Package</Link>}
      </article>)}
    </div>
    <section className="smart-glass-card rounded-[22px] p-5">
      <div className="flex items-center gap-2"><RotateCw size={16} className="text-[#00f77a]" /><h2 className="font-bold">X3 History</h2></div>
      <p className="mt-2 text-xs text-[#8b9d94]">Placement, held, released, capped and recycle records are package-specific and loaded from verified backend ledgers.</p>
    </section>
  </div>;
}

function Stat({ label, value, accent, warning }: { label: string; value: string; accent?: boolean; warning?: boolean }) {
  return <span>{label}<b className={`float-right max-w-[58%] truncate ${accent ? "text-[#00f77a]" : warning ? "text-[#e9ad45]" : "text-white"}`}>{value}</b></span>;
}
