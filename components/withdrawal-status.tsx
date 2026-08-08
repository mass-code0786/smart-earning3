"use client";
import { useEffect, useState } from "react";
import { formatTokenUnits } from "@/lib/client/money";

type Data = { availableBalance: string; minimum: string; withdrawals: {
  id: string; payout_address: string; gross_reserved: string; fee_amount: string; net_payout: string;
  status: string; tx_hash: string | null; attempt_count: number; created_at: string; updated_at: string;
}[] };
const money = (value: string) => formatTokenUnits(value);

export function WithdrawalStatus() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void fetch("/api/withdrawals", { cache: "no-store", credentials: "same-origin" })
      .then(async response => {
        if (!response.ok) throw new Error("Withdrawal history unavailable");
        return response.json();
      })
      .then(setData)
      .catch(reason => setError(reason instanceof Error ? reason.message : "Withdrawal history unavailable"));
  }, []);
  if (!data) return <section className="smart-glass-card mt-4 rounded-[22px] p-5 text-xs text-[#8b9d94]">{error || "Loading automatic withdrawals…"}</section>;
  return <section className="smart-glass-card mt-4 rounded-[22px] p-5">
    <p className="dash-label">AUTOMATIC WITHDRAWAL</p><h2 className="font-bold">Income Wallet payouts</h2>
    <p className="mt-2 text-xs text-[#8b9d94]">Available {money(data.availableBalance)} · automatic threshold {money(data.minimum)} · 10% fee. No withdrawal button is required.</p>
    <div className="mt-3">{data.withdrawals.map(withdrawal => <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-white/5 py-3 text-xs" key={withdrawal.id}>
      <span className="min-w-0">{withdrawal.status}
        <small className="block text-[#8b9d94]">Gross {money(withdrawal.gross_reserved)} · Fee {money(withdrawal.fee_amount)} · Net {money(withdrawal.net_payout)}</small>
        <small className="block break-all text-[#8b9d94]">To {withdrawal.payout_address} · attempts {withdrawal.attempt_count}</small>
        {withdrawal.tx_hash && <a className="block break-all text-[#00f77a]" target="_blank" rel="noreferrer" href={`${process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL}/tx/${withdrawal.tx_hash}`}>Transaction {withdrawal.tx_hash}</a>}
      </span>
      <small className="text-right">{new Date(withdrawal.created_at).toLocaleString()}<span className="block text-[#8b9d94]">Updated {new Date(withdrawal.updated_at).toLocaleString()}</span></small>
    </div>)}{!data.withdrawals.length && <p className="py-3 text-xs text-[#8b9d94]">No automatic withdrawal records yet.</p>}</div>
  </section>;
}
