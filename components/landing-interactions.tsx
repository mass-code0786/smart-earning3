"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { RegistrationForm } from "@/components/registration-form";
import { switchToTestnet, walletLogin, WalletLoginError } from "@/lib/client/wallet";

type Mode = "idle" | "signup";
type LandingContextValue = {
  mode: Mode;
  busy: boolean;
  status: string;
  error: string;
  activeConnect: string;
  connect: (source: string) => void;
  signup: () => void;
  cancel: () => void;
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
  const [activeConnect, setActiveConnect] = useState("");
  const locked = useRef(false);

  useEffect(() => {
    if (sessionStorage.getItem("landing-inline-mode") === "signup") setMode("signup");
  }, []);

  const revealSignup = () => requestAnimationFrame(() => {
    const element = document.getElementById("landing-inline-auth");
    if (typeof element?.scrollIntoView === "function") {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });

  const connect = useCallback(async (source: string) => {
    if (locked.current) return;
    locked.current = true;
    setActiveConnect(source);
    setBusy(true);
    setError("");
    setStatus("Connecting…");
    try {
      const authenticate = () => walletLogin(stage => {
        if (stage.startsWith("Requesting")) setStatus("Requesting signature…");
        else if (stage.startsWith("Verifying")) setStatus("Verifying…");
        else if (stage.startsWith("Connecting")) setStatus("Connecting…");
      });
      let session;
      try {
        session = await authenticate();
      } catch (reason) {
        if (!(reason instanceof WalletLoginError) || reason.code !== "WRONG_NETWORK") throw reason;
        setStatus("Connecting…");
        await switchToTestnet();
        session = await authenticate();
      }
      if (session.registered) {
        sessionStorage.removeItem("landing-inline-mode");
        router.push("/dashboard");
      } else {
        setStatus("");
        sessionStorage.setItem("landing-inline-mode", "signup");
        setMode("signup");
        revealSignup();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Wallet login failed");
      setStatus("");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }, [router]);

  const signup = useCallback(() => {
    sessionStorage.setItem("landing-inline-mode", "signup");
    setMode("signup");
    setStatus("");
    setError("");
    revealSignup();
  }, []);

  const cancel = useCallback(() => {
    if (locked.current) return;
    sessionStorage.removeItem("landing-inline-mode");
    setMode("idle");
    setStatus("");
    setError("");
  }, []);

  return (
    <LandingContext.Provider value={{
      mode, busy, status, error, activeConnect,
      connect: source => void connect(source), signup, cancel,
    }}>
      {children}
      <span hidden data-initial-sponsor={initialSponsor} data-registration-enabled={registrationEnabled}/>
    </LandingContext.Provider>
  );
}

function useLanding() {
  const value = useContext(LandingContext);
  if (!value) throw new Error("Landing action must be inside LandingInteractionProvider");
  return value;
}

export function LandingActionButtons({ compact = false }: { compact?: boolean }) {
  const { connect, signup, busy, status, error, activeConnect } = useLanding();
  const source = useId();
  const active = activeConnect === source;
  const label = active && busy ? status || "Connecting…" : "Connect";

  if (compact) return (
    <div className="flex items-start gap-2">
      <div className="flex flex-col">
        <button type="button" disabled={busy} onClick={() => connect(source)}
          className="rounded-xl border border-gold/35 bg-gold/10 px-4 py-2 text-xs font-bold text-white disabled:opacity-60">
          {label}
        </button>
        {active && error &&
          <small role="alert" className="mt-1 max-w-40 text-[9px] leading-3 text-[#ff8b94]">{error}</small>}
      </div>
      <button type="button" disabled={busy} onClick={signup}
        className="rounded-xl bg-gold px-4 py-2 text-xs font-bold text-white disabled:opacity-60">
        Signup
      </button>
    </div>
  );

  return (
    <div className="mx-auto mt-8 flex w-full max-w-[280px] flex-col gap-3">
      <button type="button" disabled={busy} onClick={() => connect(source)}
        className="flex h-12 w-full items-center justify-center rounded-xl bg-gold px-5 text-sm font-bold text-white disabled:opacity-60">
        {label}
      </button>
      {active && error &&
        <small role="alert" className="-mt-1 text-left text-[10px] leading-4 text-[#ff8b94]">{error}</small>}
      <button type="button" disabled={busy} onClick={signup}
        className="flex h-12 w-full items-center justify-center rounded-xl border border-gold/35 bg-gold/10 px-5 text-sm font-bold text-white disabled:opacity-60">
        Signup
      </button>
    </div>
  );
}

export function LandingInlinePanel({
  initialSponsor, registrationEnabled,
}: {
  initialSponsor: string;
  registrationEnabled: boolean;
}) {
  const { mode, busy, cancel } = useLanding();
  if (mode === "idle") return null;
  return (
    <section id="landing-inline-auth" className="landing-inline-auth glass is-signup">
      <header className="signup-header">
        <button type="button" disabled={busy} onClick={cancel}><ArrowLeft size={15}/> Back</button>
      </header>
      <RegistrationForm registrationEnabled={registrationEnabled} initialSponsor={initialSponsor}/>
    </section>
  );
}
