"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";

type TeamData = {
  direct_count: number;
  directIncomeHistory: {
    id: string;
    source_wallet: string;
    created_at: string;
  }[];
};

const shortWallet = (wallet: string) => `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;

export default function RealTeam() {
  const [data, setData] = useState<TeamData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/dashboard", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.user) throw new Error();
        setData(result.user);
      })
      .catch(() => setError("Verified team records could not be loaded"));
  }, []);

  if (!data) {
    return <section className="smart-glass-card rounded-[20px] p-5 text-sm text-[#8B9D94]">{error || "Loading verified team records…"}</section>;
  }

  const recentWallets = [...new Map(
    data.directIncomeHistory.map((record) => [record.source_wallet, record]),
  ).values()];

  return (
    <div className="grid gap-3">
      <section className="smart-glass-card rounded-[20px] p-5">
        <Users className="text-[#00F77A]" />
        <p className="mt-3 dash-label">VERIFIED DIRECT MEMBERS</p>
        <b className="mt-1 block text-3xl">{data.direct_count}</b>
      </section>
      <section className="smart-glass-card rounded-[20px] p-5">
        <h1 className="text-sm font-bold">Recent verified referral activity</h1>
        {recentWallets.length ? (
          <div className="mt-3 grid">
            {recentWallets.slice(0, 20).map((record) => (
              <div className="border-t border-[#00F77A]/10 py-3 first:border-0" key={record.source_wallet}>
                <b className="text-xs">{shortWallet(record.source_wallet)}</b>
                <p className="mt-1 text-[10px] text-[#8B9D94]">{new Date(record.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-[#8B9D94]">No verified referral activity yet.</p>
        )}
      </section>
    </div>
  );
}
