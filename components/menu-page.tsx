"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign, ChevronRight, CircleDollarSign, Copy, FileClock, GitBranch,
  HandCoins, Headphones, History, Layers3, LogOut, Network, PackagePlus, Share2,
  Sparkles, TrendingUp, Users, Wallet, Zap,
} from "lucide-react";
import { logoutAndRedirect } from "@/lib/client/logout";

type TeamData = { referralIdentifier: string };
type MenuRow = { label: string; href: string; icon: typeof History };

const sections: { title: string; rows: MenuRow[] }[] = [
  { title: "BOOSTER", rows: [
    { label: "Booster Wallet Topup", href: "/booster", icon: Zap },
    { label: "Booster History", href: "/history?category=BOOSTER", icon: FileClock },
  ] },
  { title: "PACKAGES", rows: [
    { label: "Buy Package", href: "/packages", icon: PackagePlus },
    { label: "Upgrade Package", href: "/packages", icon: TrendingUp },
    { label: "Package History", href: "/history?category=PACKAGE", icon: History },
  ] },
  { title: "WITHDRAW", rows: [
    { label: "Withdraw History", href: "/history?category=WITHDRAWAL", icon: HandCoins },
  ] },
  { title: "INCOME HISTORY", rows: [
    { label: "Direct Income History", href: "/history?category=DIRECT_INCOME", icon: CircleDollarSign },
    { label: "Magic Level Income History", href: "/history?category=MAGIC_LEVEL_INCOME", icon: Sparkles },
    { label: "Working X3 Income History", href: "/history?category=X3_INCOME", icon: GitBranch },
    { label: "X3 Recycle History", href: "/history?category=X3_RECYCLE", icon: GitBranch },
    { label: "Booster Income History", href: "/history?category=BOOSTER_INCOME", icon: Zap },
    { label: "Global Autopool Income History", href: "/history?category=AUTOPOOL", icon: Layers3 },
    { label: "Daily Dividend Income History", href: "/history?category=DIVIDEND", icon: BadgeDollarSign },
  ] },
  { title: "TEAM", rows: [
    { label: "Direct Team", href: "/team#direct-team", icon: Users },
    { label: "Total Team", href: "/team#total-team", icon: Network },
  ] },
  { title: "WALLET", rows: [
    { label: "Wallet Ledger / Wallet History", href: "/history?category=WALLET", icon: Wallet },
  ] },
  { title: "SUPPORT", rows: [
    { label: "Support", href: "/support", icon: Headphones },
  ] },
];

export async function logoutFromMenu(
  confirmLogout = () => window.confirm("Are you sure you want to log out?"),
  redirect = (url: string) => window.location.assign(url),
) {
  if (!confirmLogout()) return false;
  await logoutAndRedirect(redirect);
  return true;
}

export default function MenuPage() {
  const [identifier, setIdentifier] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const inviteLink = useMemo(() => identifier && typeof window !== "undefined"
    ? `${window.location.origin}/?ref=${encodeURIComponent(identifier)}` : "", [identifier]);

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
    <section className="menu-section">
      <h2>INVITE</h2>
      <div className="menu-invite smart-glass-card">
        <Link href="/team" aria-label="Referral Link">
          <span><small>Referral Link</small><b>{inviteLink || (error || "Loading invite link…")}</b></span>
        </Link>
        <button type="button" aria-label="Copy Link" disabled={!inviteLink} onClick={() => void copyInvite()}><Copy size={16}/></button>
        {typeof navigator !== "undefined" && typeof navigator.share === "function" &&
          <button type="button" aria-label="Share Link" disabled={!inviteLink} onClick={() => void shareInvite()}><Share2 size={16}/></button>}
        {notice && <p role="status">{notice}</p>}
      </div>
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
      <i><LogOut size={18}/></i><span>Logout</span><ChevronRight size={16}/>
    </button>
  </div>;
}
