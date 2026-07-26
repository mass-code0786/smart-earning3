import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export function VerifiedModuleState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="smart-glass-card rounded-[22px] p-6">
      <ShieldCheck className="text-[#00F77A]" />
      <h1 className="mt-4 text-xl font-bold">{title}</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-[#8B9D94]">{description}</p>
      <p className="mt-4 text-xs text-[#8B9D94]">No unverified or placeholder financial records are displayed.</p>
      <Link href="/dashboard" className="mt-5 inline-block text-xs font-semibold text-[#00F77A]">
        Return to dashboard
      </Link>
    </section>
  );
}
