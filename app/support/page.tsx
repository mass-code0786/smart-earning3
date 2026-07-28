import { Headphones, ShieldCheck } from "lucide-react";
import { SmartEarningPageShell } from "@/components/smart-earning-shell";

export default function Page() {
  return <SmartEarningPageShell>
    <div className="mx-auto grid max-w-[620px] gap-4">
      <h1 className="text-xl font-extrabold">Support</h1>
      <section className="smart-glass-card rounded-[20px] p-5">
        <Headphones className="text-[#00F77A]" size={24}/>
        <h2 className="mt-3 text-base font-bold">Smart Earning Support</h2>
        <p className="mt-2 text-xs leading-5 text-[#8B9D94]">For account or transaction assistance, contact an official Smart Earning support representative and include your wallet address and transaction hash when available.</p>
      </section>
      <section className="smart-glass-card flex gap-3 rounded-[20px] p-5 text-xs leading-5 text-[#8B9D94]">
        <ShieldCheck className="mt-0.5 shrink-0 text-[#00F77A]" size={18}/>
        <p>Never share your seed phrase or private key. Support will not ask you to transfer funds to verify your account.</p>
      </section>
    </div>
  </SmartEarningPageShell>;
}
