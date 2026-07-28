"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpCircle,
  Copy,
  Gift,
  PackagePlus,
  RefreshCw,
  Rocket,
  UserPlus,
} from "lucide-react";
import { SmartEarningPageShell } from "@/components/smart-earning-shell";
import { formatTokenUnits } from "@/lib/client/money";

type DashboardData = {
  wallet_address: string;
  direct_count: number;
};

type X3Package = {
  packageId: number;
  priceTokenUnits: string;
  active: boolean;
  slots: { slotNumber: number; wallet: string }[];
  earnedIncome: string;
};

type X4Package = {
  packageId: number;
  priceTokenUnits: string;
  active: boolean;
  slots: { slotNumber: number; level: number; wallet: string }[];
  totalEarnings: string;
};

type HomeData = {
  user: DashboardData;
  x3: X3Package[];
  x4: X4Package[];
};

const shortWallet = (wallet: string) => `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
const initials = (wallet: string) => wallet.slice(2, 4).toUpperCase();
const profit = (values: string[]) => formatTokenUnits(
  values.reduce((total, value) => total + BigInt(value), 0n).toString(),
);

async function json(path: string) {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin" });
  if (response.status === 401) throw new Error("UNAUTHENTICATED");
  const body = await response.json();
  if (!response.ok) throw new Error("LOAD_FAILED");
  return body;
}

export default function RealDashboard() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();

  async function load() {
    setError("");
    try {
      const [dashboard, x3, x4] = await Promise.all([
        json("/api/dashboard"),
        json("/api/x3/packages"),
        json("/api/x4/packages"),
      ]);
      if (!dashboard.user) {
        router.replace("/register");
        return;
      }
      setData({ user: dashboard.user, x3: x3.packages, x4: x4.packages });
    } catch (cause) {
      if (cause instanceof Error && cause.message === "UNAUTHENTICATED") {
        router.replace("/login");
        return;
      }
      setError("Home data could not be loaded");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const teamWallets = useMemo(() => {
    if (!data) return 0;
    return new Set([
      ...data.x3.flatMap((item) => item.slots.map((slot) => slot.wallet.toLowerCase())),
      ...data.x4.flatMap((item) => item.slots.map((slot) => slot.wallet.toLowerCase())),
    ]).size;
  }, [data]);

  return (
    <SmartEarningPageShell home>
      {!data ? (
        <section className="home-state-card">
          <p>{error || "Loading Home…"}</p>
          {error && <button type="button" onClick={() => void load()}><RefreshCw size={14} /> Retry</button>}
        </section>
      ) : (
        <div className="home-page">
          <TeamSummary user={data.user} totalTeam={teamWallets} />
          <section className="home-hero-composition" aria-label="Home actions">
            <div className="home-action-grid">
              <HomeAction href="/packages" label="Buy Package" icon={PackagePlus} />
              <HomeAction href="/packages" label="Upgrade Package" icon={ArrowUpCircle} />
              <HomeAction href="/booster" label="Booster Topup" icon={Rocket} />
              <HomeAction href="/team" label="Invite" icon={UserPlus} />
            </div>
          </section>
          <div className="home-matrix-list">
            <MatrixCard
              kind="X3"
              profit={profit(data.x3.map((item) => item.earnedIncome))}
              packages={data.x3}
              href="/matrix/x3"
            />
            <MatrixCard
              kind="X4"
              profit={profit(data.x4.map((item) => item.totalEarnings))}
              packages={data.x4}
              href="/matrix/x4"
            />
          </div>
        </div>
      )}
    </SmartEarningPageShell>
  );
}

function TeamSummary({ user, totalTeam }: { user: DashboardData; totalTeam: number }) {
  return (
    <section className="home-team-summary">
      <div><b>{user.direct_count}</b><span>Direct Members</span></div>
      <div className="home-team-identity">
        <i>{initials(user.wallet_address)}</i>
        <span>
          <b>{shortWallet(user.wallet_address)}</b>
          <button
            type="button"
            aria-label="Copy wallet address"
            onClick={() => navigator.clipboard?.writeText(user.wallet_address)}
          ><Copy size={12} /></button>
        </span>
      </div>
      <div><b>{totalTeam}</b><span>Total Team</span></div>
    </section>
  );
}

function HomeAction({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof Gift;
}) {
  return (
    <Link href={href} className="home-action-card">
      <span><Icon size={20} /></span>
      <b>{label}</b>
    </Link>
  );
}

function MatrixCard({
  kind,
  profit: value,
  packages,
  href,
}: {
  kind: "X3" | "X4";
  profit: string;
  packages: (X3Package | X4Package)[];
  href: string;
}) {
  return (
    <section className={`home-matrix-card home-matrix-${kind.toLowerCase()}`}>
      <header>
        <span><small>Total Profit</small><b>{value} <em>USDT</em></b></span>
        <strong>{kind}</strong>
      </header>
      <div className="home-matrix-packages" aria-label={`${kind} package overview`}>
        {packages.map((item) => (
          <div className={item.active ? "is-active" : "is-locked"} key={item.packageId}>
            <span>{item.active ? item.packageId : "🔒"}</span>
            <b>${BigInt(item.priceTokenUnits) / 1_000_000n}</b>
          </div>
        ))}
      </div>
      <Link href={href}>Preview</Link>
    </section>
  );
}
