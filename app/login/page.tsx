import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";
import { WalletLogin } from "@/components/wallet-login";

export default function Page() {
  return (
    <AuthFrame
      title="Wallet login"
      copy="Connect on BNB Testnet and sign a one-time nonce. Signing is free and cannot move funds."
    >
      <WalletLogin />
      <p className="mt-5 text-center text-xs text-white/40">
        Not registered?{" "}
        <Link className="text-gold" href="/register">Register with USDT</Link>
      </p>
    </AuthFrame>
  );
}
