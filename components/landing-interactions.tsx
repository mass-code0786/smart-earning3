"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Wallet } from "lucide-react";
import { RegistrationForm } from "@/components/registration-form";
import { switchToTestnet, walletLogin, WalletLoginError } from "@/lib/client/wallet";

type Mode = "idle" | "connect" | "signup";
type LandingContextValue = {
  mode: Mode;
  busy: boolean;
  status: string;
  error: string;
  wrongNetwork: boolean;
  connect: () => void;
  signup: () => void;
  cancel: () => void;
  switchNetwork: () => void;
};
const LandingContext = createContext<LandingContextValue | null>(null);

export function LandingInteractionProvider({
  children, initialSponsor, registrationEnabled,
}: {
  children: React.ReactNode;
  initialSponsor: string;
  registrationEnabled: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const locked = useRef(false);
  useEffect(() => {
    if (sessionStorage.getItem("landing-inline-mode") === "signup") setMode("signup");
  }, []);

  const reveal = () => requestAnimationFrame(() => {
    const element = document.getElementById("landing-inline-auth");
    if (typeof element?.scrollIntoView === "function") element.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  const connect = useCallback(async () => {
    if (locked.current) return;
    locked.current = true;
    setMode("connect"); setBusy(true); setError(""); setWrongNetwork(false);
    setStatus("Connecting wallet…"); reveal();
    try {
      const session = await walletLogin(setStatus);
      setStatus("Connected");
      if (session.registered) router.push("/dashboard");
      else {
        setStatus("");
        sessionStorage.setItem("landing-inline-mode", "signup");
        setMode("signup");
      }
    } catch (reason) {
      const known = reason instanceof WalletLoginError;
      setWrongNetwork(known && reason.code === "WRONG_NETWORK");
      setError(reason instanceof Error ? reason.message : "Wallet login failed");
      setStatus("");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }, [router]);

  const signup = useCallback(() => {
    sessionStorage.setItem("landing-inline-mode", "signup");
    setMode("signup"); setStatus(""); setError(""); setWrongNetwork(false); reveal();
  }, []);
  const cancel = useCallback(() => {
    if (locked.current) return;
    sessionStorage.removeItem("landing-inline-mode");
    setMode("idle"); setStatus(""); setError(""); setWrongNetwork(false);
  }, []);
  const switchNetwork = useCallback(async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      await switchToTestnet();
      locked.current = false; setBusy(false);
      void connect();
      return;
    } catch (reason) {
      setError(reason instanceof WalletLoginError ? reason.message : "Wallet could not switch networks");
    } finally {
      locked.current = false; setBusy(false);
    }
  }, [connect]);

  return <LandingContext.Provider value={{ mode, busy, status, error, wrongNetwork, connect: () => void connect(), signup, cancel, switchNetwork: () => void switchNetwork() }}>
    {children}
    <span hidden data-initial-sponsor={initialSponsor} data-registration-enabled={registrationEnabled}/>
  </LandingContext.Provider>;
}

function useLanding() {
  const value = useContext(LandingContext);
  if (!value) throw new Error("Landing action must be inside LandingInteractionProvider");
  return value;
}

export function LandingActionButtons({ compact = false }: { compact?: boolean }) {
  const { connect, signup, busy } = useLanding();
  if (compact) return <div className="flex gap-2">
    <button type="button" disabled={busy} onClick={connect} className="rounded-xl border border-gold/35 bg-gold/10 px-4 py-2 text-xs font-bold text-white disabled:opacity-60">Connect</button>
    <button type="button" disabled={busy} onClick={signup} className="rounded-xl bg-gold px-4 py-2 text-xs font-bold text-white disabled:opacity-60">Signup</button>
  </div>;
  return <div className="mx-auto mt-8 flex w-full max-w-[280px] flex-col gap-3">
    <button type="button" disabled={busy} onClick={connect} className="flex h-12 w-full items-center justify-center rounded-xl bg-gold px-5 text-sm font-bold text-white disabled:opacity-60">{busy ? "Connecting wallet…" : "Connect"}</button>
    <button type="button" disabled={busy} onClick={signup} className="flex h-12 w-full items-center justify-center rounded-xl border border-gold/35 bg-gold/10 px-5 text-sm font-bold text-white disabled:opacity-60">Signup</button>
  </div>;
}

export function LandingInlinePanel({ initialSponsor, registrationEnabled }: { initialSponsor: string; registrationEnabled: boolean }) {
  const { mode, busy, status, error, wrongNetwork, cancel, switchNetwork } = useLanding();
  if (mode === "idle") return null;
  return <section id="landing-inline-auth" className={`landing-inline-auth glass ${mode === "signup" ? "is-signup" : ""}`}>
    <header className={mode === "signup" ? "signup-header" : ""}>
      {mode === "connect" && <div><Wallet size={20}/><span><small>SECURE ACCESS</small><h2>Connect Wallet</h2></span></div>}
      <button type="button" disabled={busy} onClick={cancel}><ArrowLeft size={15}/> Back</button>
    </header>
    {mode === "connect" ? <div className="landing-connect-progress">
      <span className={busy ? "is-busy" : ""}><Wallet size={22}/></span>
      <b>{status || "Wallet connection paused"}</b>
      <p>{error || "Complete the wallet prompts to authenticate securely."}</p>
      {wrongNetwork && <button type="button" disabled={busy} onClick={switchNetwork}>Switch network</button>}
    </div> : <RegistrationForm compact registrationEnabled={registrationEnabled} initialSponsor={initialSponsor}/>}
  </section>;
}
