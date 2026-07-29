"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { registerOnTestnet, walletLogin } from "@/lib/client/wallet";

export function RegistrationForm({
  registrationEnabled,
  initialSponsor = "",
  compact = false,
}: {
  registrationEnabled: boolean;
  initialSponsor?: string;
  compact?: boolean;
}) {
  const [sponsor, setSponsor] = useState(initialSponsor);
  const [status, setStatus] = useState("");
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [connectedWallet, setConnectedWallet] = useState("");
  const locked = useRef(false);
  const router = useRouter();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!registrationEnabled) {
      setStatus("BSC Testnet registration configuration is incomplete");
      return;
    }
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setHash("");
    try {
      setStatus("Authenticating wallet…");
      const session = await walletLogin();
      setConnectedWallet(session.wallet);
      if (session.registered) {
        router.replace("/dashboard");
        return;
      }
      if (session.wallet === sponsor.toLowerCase()) {
        throw new Error("Self-referral is not allowed");
      }
      const result = await registerOnTestnet(sponsor, setStatus);
      if (result.alreadyRegistered) {
        setStatus("Wallet is already registered. Redirecting to dashboard.");
        router.replace("/dashboard");
        router.refresh();
        return;
      }
      setHash(result.txHash);
      setStatus("Registration verified and activated. Redirecting to dashboard…");
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Registration failed");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={compact ? "grid gap-3" : "grid gap-4"}>
      {!compact && <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-gold/20 bg-black/20 p-3">
          <small className="text-white/45">Registration</small>
          <b className="mt-1 block text-gold">2 USDT</b>
        </div>
        <div className="rounded-xl border border-gold/20 bg-black/20 p-3">
          <small className="text-white/45">Network fee</small>
          <b className="mt-1 block">BNB gas, separate</b>
        </div>
      </div>}
      {!compact && <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/55">
        <p>The unified contract forwards the full $2 payment to treasury and records $1 Registration Magic accounting.</p>
        <p className="mt-2">Only BNB Smart Chain Testnet (chain ID 97) is enabled.</p>
      </div>}
      <label className="text-xs font-medium text-white">
        {compact ? "Sponsor Wallet" : "Sponsor wallet"}
        <input
          required
          value={sponsor}
          onChange={(event) => setSponsor(event.target.value.trim())}
          pattern="^0x[a-fA-F0-9]{40}$"
          placeholder="0x…"
          className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white outline-none focus:border-gold"
        />
      </label>
      {connectedWallet && (
        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/60">
          <span className="block">Connected registration wallet</span>
          <b className="mt-1 block break-all text-white">{connectedWallet}</b>
        </div>
      )}
      <button
        disabled={busy || !registrationEnabled}
        className="flex items-center justify-center gap-2 rounded-xl bg-gold p-4 text-sm font-bold text-black disabled:opacity-50"
      >
        {!compact && <ShieldCheck size={17} />}
        {busy ? "Processing…" : compact ? "Signup" : "Register with 2 USDT"}
      </button>
      {!registrationEnabled && (
        <p role="alert" className="rounded-xl border border-[#e9ad45]/25 bg-[#e9ad45]/5 p-3 text-xs leading-5 text-[#e9c47c]">
          {compact ? "Signup is temporarily unavailable" : "BSC Testnet registration configuration is incomplete"}
        </p>
      )}
      {status && (
        <p role="status" className="rounded-xl border border-gold/20 bg-gold/5 p-3 text-xs leading-5 text-white/70">
          {status}
        </p>
      )}
      {hash && (
        <a
          className="flex items-center gap-2 break-all text-xs text-gold"
          target="_blank"
          rel="noreferrer"
          href={`https://testnet.bscscan.com/tx/${hash}`}
        >
          <CheckCircle2 size={16} />
          View verified registration transaction
        </a>
      )}
    </form>
  );
}
