"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, RefreshCw, Users, WalletCards } from "lucide-react";
import { SmartEarningPageShell } from "@/components/smart-earning-shell";
import { PackageCapDashboard } from "@/components/package-page";
import { formatTokenUnits } from "@/lib/client/money";

type DashboardData = {
  wallet_address: string;
  direct_count: number;
  sponsor_wallet: string | null;
  registration_status: string | null;
  magicBalance: string;
  directIncomeTotal: string;
  directIncomeToday: string;
  directIncomeHistory: {
    id: string;
    amount_token_units: string;
    tx_hash: string;
    source_wallet: string;
    created_at: string;
  }[];
  financial: {
    income_wallet: string; income_reserved: string; total_withdrawn: string;
    hold_wallet: string; booster_wallet: string; dividend_income: string;
    gross_earned: string; magic_contribution: string; income_credited: string;
    cap_total: string; cap_used: string; cap_remaining: string; active_package: string;
  };
};

const money = (value: string) => formatTokenUnits(value);
const shortWallet = (wallet: string) => `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;

export default function RealDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const router = useRouter();

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/dashboard", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      const result = await response.json();
      if (!response.ok) throw new Error("Dashboard data could not be loaded");
      if (!result.user) {
        router.replace("/register");
        return;
      }
      setData(result.user);
    } catch {
      setError("Verified dashboard data is temporarily unavailable");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <SmartEarningPageShell>
      {loading ? (
        <section className="smart-glass-card rounded-[20px] p-5 text-sm text-[#8B9D94]">
          Loading verified wallet records…
        </section>
      ) : error || !data ? (
        <section className="smart-glass-card rounded-[20px] p-5">
          <p className="text-sm text-[#F5FFF9]">{error || "Wallet registration is required"}</p>
          <button className="mt-4 flex items-center gap-2 text-xs text-[#00F77A]" onClick={() => void load()}>
            <RefreshCw size={14} /> Retry
          </button>
        </section>
      ) : (
        <div className="grid gap-3">
          <section className="dash-glass rounded-[20px] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="dash-label">AUTHENTICATED WALLET</p>
                <h1 className="mt-1 truncate text-lg font-bold">{shortWallet(data.wallet_address)}</h1>
              </div>
              <button
                type="button"
                aria-label="Copy wallet address"
                className="dash-icon"
                onClick={() => navigator.clipboard?.writeText(data.wallet_address)}
              >
                <Copy size={16} />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <VerifiedStat label="Income Wallet" value={money(data.financial.income_wallet)} icon={WalletCards} />
              <VerifiedStat label="Magic Wallet" value={money(data.magicBalance)} icon={WalletCards} />
              <VerifiedStat label="X3 Hold Wallet" value={money(data.financial.hold_wallet)} />
              <VerifiedStat label="Booster Wallet" value={money(data.financial.booster_wallet)} />
              <VerifiedStat label="Total earned" value={money(data.financial.gross_earned)} />
              <VerifiedStat label="Total withdrawn" value={money(data.financial.total_withdrawn)} />
              <VerifiedStat label="Pending withdrawal" value={money(data.financial.income_reserved)} />
              <VerifiedStat label="Dividend income" value={money(data.financial.dividend_income)} />
              <VerifiedStat label="5X cap used" value={money(data.financial.cap_used)} />
              <VerifiedStat label="5X cap remaining" value={money(data.financial.cap_remaining)} />
              <VerifiedStat label="Active package value" value={money(data.financial.active_package)} />
              <VerifiedStat label="Direct members" value={String(data.direct_count)} icon={Users} />
            </div>
            <p className="mt-3 text-[10px] text-[#8B9D94]">
              Status: {data.registration_status || "ACTIVE"}
              {data.sponsor_wallet ? ` · Sponsor ${shortWallet(data.sponsor_wallet)}` : ""}
            </p>
          </section>

          <PackageCapDashboard />

          <section className="smart-glass-card rounded-[20px] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="dash-label">VERIFIED LEDGER</p>
                <h2 className="mt-1 text-sm font-bold">Recent direct income</h2>
              </div>
            </div>
            {data.directIncomeHistory.length ? (
              <div className="mt-3 grid">
                {data.directIncomeHistory.slice(0, 10).map((record) => (
                  <a
                    key={record.id}
                    href={`https://testnet.bscscan.com/tx/${record.tx_hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="grid grid-cols-[1fr_auto] gap-2 border-t border-[#00F77A]/10 py-3 text-xs first:border-t-0"
                  >
                    <span className="min-w-0">
                      <b className="block truncate">{shortWallet(record.source_wallet)}</b>
                      <small className="text-[#8B9D94]">{new Date(record.created_at).toLocaleString()}</small>
                    </span>
                    <strong className="text-[#00F77A]">+{money(record.amount_token_units)}</strong>
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-[#8B9D94]">No verified direct-income records yet.</p>
            )}
          </section>
        </div>
      )}
    </SmartEarningPageShell>
  );
}

function VerifiedStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: typeof Users;
}) {
  return (
    <div className="rounded-xl border border-[#00F77A]/10 bg-black/10 p-3">
      <div className="flex items-center gap-1 text-[#00F77A]">
        {Icon && <Icon size={13} />}
        <p className="dash-label">{label}</p>
      </div>
      <b className="mt-2 block truncate text-sm">{value}</b>
    </div>
  );
}
