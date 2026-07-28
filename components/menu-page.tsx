"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign, ChevronRight, CircleDollarSign, Copy, FileClock, GitBranch,
  HandCoins, History, Layers3, LogOut, Network, PackagePlus, Share2, Sparkles,
  TrendingUp, Users, Wallet, WalletCards, Zap,
} from "lucide-react";

type TeamData = { referralIdentifier: string };
type MenuRow = { label: string; href: string; icon: typeof History };

const sections: { title: string; rows: MenuRow[] }[] = [
  { title: "GLOBAL X3 BOOSTER", rows: [
    { label: "Booster Wallet Topup", href: "/booster", icon: Zap },
    { label: "Booster Activation Wallet History", href: "/history?category=BOOSTER", icon: FileClock },
    { label: "X3 Booster Structure", href: "/matrix/x3", icon: GitBranch },
  ] },
  { title: "PACKAGES", rows: [
    { label: "Buy Package", href: "/packages", icon: PackagePlus },
    { label: "Upgrade Package", href: "/packages", icon: TrendingUp },
    { label: "Transaction List", href: "/history?category=PACKAGES", icon: History },
  ] },
  { title: "WITHDRAW", rows: [
    { label: "Account Summary", href: "/wallet", icon: WalletCards },
    { label: "Withdraw History", href: "/history?category=WITHDRAWALS", icon: HandCoins },
  ] },
  { title: "INCOME REPORT", rows: [
    { label: "Direct Income", href: "/history?category=DIRECT_INCOME", icon: CircleDollarSign },
    { label: "Magic Level Income", href: "/history?category=MAGIC_LEVEL", icon: Sparkles },
    { label: "Working X3 Matrix Income", href: "/history?category=X3", icon: GitBranch },
    { label: "Non Working X4 Matrix Income", href: "/history?category=X4", icon: Network },
    { label: "X3 Booster Income", href: "/history?category=BOOSTER_INCOME", icon: Zap },
    { label: "Global Auto Pool Income", href: "/history?category=AUTOPOOL", icon: Layers3 },
    { label: "Daily Dividend Income", href: "/history?category=DIVIDEND", icon: BadgeDollarSign },
  ] },
  { title: "OTHER REPORTS", rows: [
    { label: "Magic Wallet Report", href: "/wallet?section=magic", icon: Wallet },
    { label: "Magic Level Report", href: "/history?category=MAGIC_LEVEL", icon: Sparkles },
    { label: "Hold Wallet Report", href: "/wallet?section=hold", icon: WalletCards },
  ] },
  { title: "AFFILIATE", rows: [
    { label: "Direct Affiliate", href: "/team?view=direct", icon: Users },
    { label: "Team Affiliate", href: "/team?view=all", icon: Network },
  ] },
];

export async function logoutFromMenu(
  confirmLogout = () => window.confirm("Are you sure you want to log out?"),
  redirect = (url: string) => window.location.assign(url),
) {
  if (!confirmLogout()) return false;
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } finally {
    redirect("/login");
  }
  return true;
}

export default function MenuPage() {
  const [identifier, setIdentifier] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const inviteLink = useMemo(() => identifier && typeof window !== "undefined"
    ? `${window.location.origin}/register?ref=${encodeURIComponent(identifier)}` : "", [identifier]);

  useEffect(() => {
    void fetch("/api/team", { cache: "no-store", credentials: "same-origin" })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Invite link could not be loaded");
        setIdentifier((body as TeamData).referralIdentifier);
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : "Invite link could not be loaded"));
  }, []);

  async function copyInvite() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setNotice("Invite link copied");
  }
  async function shareInvite() {
    if (!inviteLink || !navigator.share) return;
    await navigator.share({ title: "Smart Earning", text: `Join Smart Earning: ${inviteLink}`, url: inviteLink });
  }
  return <div className="menu-page">
    <h1 className="menu-title">Menu</h1>
    <section className="menu-invite smart-glass-card">
      <Link href="/team" aria-label="Open team referral page">
        <span><small>Your Invite Link</small><b>{inviteLink || (error || "Loading invite link…")}</b></span>
      </Link>
      <button type="button" aria-label="Copy invite link" disabled={!inviteLink} onClick={() => void copyInvite()}><Copy size={16}/></button>
      {typeof navigator !== "undefined" && typeof navigator.share === "function" &&
        <button type="button" aria-label="Share invite link" disabled={!inviteLink} onClick={() => void shareInvite()}><Share2 size={16}/></button>}
      {notice && <p role="status">{notice}</p>}
    </section>
    {sections.map(section => <section className="menu-section" key={section.title}>
      <h2>{section.title}</h2>
      <div className="menu-group smart-glass-card">
        {section.rows.map(({ label, href, icon: Icon }) =>
          <Link className="menu-row" href={href} key={label}>
            <i><Icon size={17}/></i><span>{label}</span><ChevronRight size={16}/>
          </Link>)}
      </div>
    </section>)}
    <button type="button" className="menu-logout smart-glass-card" onClick={() => void logoutFromMenu()}>
      <i><LogOut size={18}/></i><span>Log out</span><ChevronRight size={16}/>
    </button>
  </div>;
}
