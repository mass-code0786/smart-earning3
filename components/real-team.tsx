"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Share2, Users } from "lucide-react";
import { formatTokenUnits } from "@/lib/client/money";

type DirectMember = {
  wallet_address: string;
  status: string;
  joined_at: string;
  active_package_value: string;
};
type TeamData = {
  referralIdentifier: string;
  directMembers: number;
  totalTeam: number;
  activeMembers: number;
  inactiveMembers: number;
  directs: DirectMember[];
};

const shortWallet = (wallet: string) => `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;

export default function RealTeam() {
  const [data, setData] = useState<TeamData | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const referralLink = useMemo(
    () => data && typeof window !== "undefined"
      ? `${window.location.origin}/register?ref=${encodeURIComponent(data.referralIdentifier)}`
      : "",
    [data],
  );

  useEffect(() => {
    void fetch("/api/team", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Team records could not be loaded");
        setData(result);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Team records could not be loaded"));
  }, []);

  async function copy(value: string, message: string) {
    await navigator.clipboard.writeText(value);
    setNotice(message);
  }

  async function share() {
    if (!referralLink || !navigator.share) return;
    await navigator.share({
      title: "Smart Earning",
      text: `Join Smart Earning using my referral link: ${referralLink}`,
      url: referralLink,
    });
  }

  if (!data) {
    return <section className="smart-glass-card rounded-[20px] p-5 text-sm text-[#8B9D94]">{error || "Loading verified team records…"}</section>;
  }

  return (
    <div className="team-page grid gap-3">
      <section className="team-referral-card smart-glass-card rounded-[20px] p-4">
        <p className="dash-label">YOUR REFERRAL LINK</p>
        <div className="mt-3 flex min-w-0 items-center gap-2 rounded-xl border border-[#00F77A]/15 bg-black/20 p-3">
          <span className="min-w-0 flex-1 break-all text-[10px] leading-4 text-[#D8E7DF]">{referralLink}</span>
          <button type="button" aria-label="Copy referral link" onClick={() => void copy(referralLink, "Referral link copied")} className="dash-icon shrink-0"><Copy size={15} /></button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void copy(referralLink, "Referral link copied")} className="team-action-button"><Copy size={15} />Copy Link</button>
          {typeof navigator !== "undefined" && typeof navigator.share === "function"
            ? <button type="button" onClick={() => void share()} className="team-action-button"><Share2 size={15} />Share</button>
            : <button type="button" disabled className="team-action-button opacity-50"><Share2 size={15} />Share</button>}
        </div>
        {notice && <p role="status" className="mt-2 text-[10px] text-[#00F77A]">{notice}</p>}
      </section>

      <section id="total-team" className="grid grid-cols-2 gap-2">
        {[
          ["Direct Members", data.directMembers],
          ["Total Team", data.totalTeam],
          ["Active Members", data.activeMembers],
          ["Inactive Members", data.inactiveMembers],
        ].map(([label, value]) => <div className="smart-glass-card rounded-[16px] p-3" key={label}><small className="text-[9px] text-[#8B9D94]">{label}</small><b className="mt-1 block text-xl">{value}</b></div>)}
      </section>

      <section id="direct-team" className="smart-glass-card rounded-[20px] p-4">
        <div className="flex items-center gap-2"><Users size={17} className="text-[#00F77A]" /><h1 className="text-sm font-bold">Direct Team</h1></div>
        {data.directs.length ? <div className="mt-3 grid">
          {data.directs.map((member) => <div className="team-member-row border-t border-[#00F77A]/10 py-3 first:border-0" key={member.wallet_address}>
            <div className="flex min-w-0 items-center gap-2">
              <b className="truncate text-xs">{shortWallet(member.wallet_address)}</b>
              <button type="button" aria-label={`Copy wallet ${member.wallet_address}`} onClick={() => void copy(member.wallet_address, "Wallet copied")} className="text-[#00F77A]"><Copy size={13} /></button>
              <span className={member.status === "ACTIVE" ? "team-status-active" : "team-status-inactive"}>{member.status}</span>
            </div>
            <p className="mt-1 text-[10px] text-[#8B9D94]">{new Date(member.joined_at).toLocaleString()}</p>
            <p className="mt-1 text-[10px] text-[#8B9D94]">Active package <b className="text-[#F5FFF9]">{formatTokenUnits(member.active_package_value)} USDT</b></p>
          </div>)}
        </div> : <p className="mt-3 text-xs text-[#8B9D94]">No direct members yet.</p>}
      </section>
    </div>
  );
}
