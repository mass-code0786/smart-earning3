"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet } from "lucide-react";
import { switchToTestnet, walletLogin, WalletLoginError } from "@/lib/client/wallet";

export function WalletLogin() {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const locked = useRef(false);
  const router = useRouter();

  async function login() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setWrongNetwork(false);
    setStatus("Open your wallet and approve the secure login request.");
    try {
      const session = await walletLogin();
      setStatus("Wallet verified.");
      if (session.registrationState === "ACTIVE" || session.registered) router.push("/dashboard");
      else if (session.registrationState === "UNREGISTERED") router.push("/register");
      else setStatus("Registration synchronization is still pending. Please try again shortly.");
      router.refresh();
    } catch (error) {
      const known = error instanceof WalletLoginError;
      setWrongNetwork(known && error.code === "WRONG_NETWORK");
      setStatus(known && error.code === "WRONG_NETWORK" ? "Please switch to the supported network and try again." : known ? error.message : "Wallet login failed");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  async function switchNetwork() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await switchToTestnet();
      setWrongNetwork(false);
      setStatus("Supported network selected. Continue to connect.");
    } catch (error) {
      setStatus(error instanceof WalletLoginError ? error.message : "Wallet could not switch networks");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return <>
    <button type="button" disabled={busy} onClick={login} className="auth-primary">
      <Wallet size={17}/>{busy ? "Waiting for wallet…" : "Connect"}
    </button>
    {wrongNetwork && <button type="button" disabled={busy} onClick={switchNetwork} className="auth-secondary">
      Switch network
    </button>}
    {status && <p role="status" className="auth-status">{status}</p>}
  </>;
}
