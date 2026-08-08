"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { authenticatedWalletSession, RegistrationFlowError, registerOnTestnet, walletLogin } from "@/lib/client/wallet";
import { presentBlockchainError } from "@/lib/client/blockchain-error";

export function RegistrationForm({
  registrationEnabled,
  initialSponsor = "",
}: {
  registrationEnabled: boolean;
  initialSponsor?: string;
}) {
  const [sponsor, setSponsor] = useState(initialSponsor);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [connectedWallet, setConnectedWallet] = useState("");
  const locked = useRef(false);
  const router = useRouter();

  useEffect(() => {
    void authenticatedWalletSession().then(session => {
      if (session.registrationState === "ACTIVE" || session.registered) {
        sessionStorage.removeItem("landing-inline-mode");
        router.replace("/dashboard");
      }
    }).catch(() => undefined);
  }, [router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!registrationEnabled) {
      setError("Signup is temporarily unavailable");
      return;
    }
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setHash("");
    setError("");
    try {
      setStatus("Authenticating wallet…");
      const session = await walletLogin();
      setConnectedWallet(session.wallet);
      if (session.registered) {
        sessionStorage.removeItem("landing-inline-mode");
        router.replace("/dashboard");
        return;
      }
      if (session.wallet === sponsor.toLowerCase()) {
        throw new RegistrationFlowError("INVALID_SPONSOR", "Self-referral is not allowed");
      }
      const result = await registerOnTestnet(sponsor, setStatus);
      if (result.alreadyRegistered) {
        setStatus("Wallet is already registered on-chain and synchronization is pending.");
        return;
      }
      setHash(result.txHash);
      if (result.pendingSync) {
        setStatus("Registration succeeded on-chain and is pending synchronization. Submit again to retry.");
        return;
      }
      setStatus("Registration verified and activated. Redirecting to dashboard…");
      sessionStorage.removeItem("landing-inline-mode");
      router.replace("/dashboard");
      router.refresh();
    } catch (reason) {
      setStatus("");
      setError(reason instanceof RegistrationFlowError
        ? `${reason.message} (${reason.code})`
        : presentBlockchainError("Registration transaction failed", reason, "Registration failed. Please try again."));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <label className="text-xs font-medium text-white">
        Sponsor Wallet
        <input required value={sponsor}
          onChange={event => setSponsor(event.target.value.trim())}
          pattern="^0x[a-fA-F0-9]{40}$" placeholder="0x…"
          className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white outline-none focus:border-gold"/>
      </label>
      {connectedWallet && (
        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/60">
          <span className="block">Connected registration wallet</span>
          <b className="mt-1 block break-all text-white">{connectedWallet}</b>
        </div>
      )}
      <button disabled={busy || !registrationEnabled}
        className="flex items-center justify-center rounded-xl bg-gold p-4 text-sm font-bold text-black disabled:opacity-50">
        {busy ? "Processing…" : "Signup"}
      </button>
      {!registrationEnabled && (
        <p role="alert" className="rounded-lg border border-[#e9ad45]/20 bg-black/25 px-3 py-2 text-xs leading-5 text-[#e9c47c]">
          Signup is temporarily unavailable
        </p>
      )}
      {status && <p role="status" className="text-xs leading-5 text-white/70">{status}</p>}
      {error && (
        <p role="alert" className="max-h-28 min-w-0 max-w-full overflow-y-auto rounded-lg border border-[#ff7f8a]/20 bg-black/25 px-3 py-2 text-xs leading-5 text-[#ffadb4] [overflow-wrap:anywhere] [word-break:break-word]">
          {error}
        </p>
      )}
      {hash && (
        <a className="flex items-center gap-2 break-all text-xs text-gold" target="_blank" rel="noreferrer"
          href={`${process.env.NEXT_PUBLIC_BLOCK_EXPLORER_URL}/tx/${hash}`}>
          <CheckCircle2 size={16}/> View verified registration transaction
        </a>
      )}
    </form>
  );
}
