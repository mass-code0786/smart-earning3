import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";
import { WalletLogin } from "@/components/wallet-login";

export default function Page() {
  return (
    <AuthFrame
      title="Connect Wallet"
      copy="Connect your wallet securely to access your Smart Earning account."
      fullPage
    >
      <WalletLogin />
      <p className="auth-login-signup">
        New user?{" "}
        <Link className="text-gold" href="/register">Signup</Link>
      </p>
    </AuthFrame>
  );
}
