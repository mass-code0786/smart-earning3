import Link from "next/link";
import { Shell } from "@/components/ui";

export default function Page() {
  return (
    <Shell>
      <section className="smart-glass-card rounded-[22px] p-6">
        <p className="dash-label">VERIFIED MATRIX RECORDS</p>
        <h1 className="mt-2 text-2xl font-bold">Matrix</h1>
        <p className="mt-2 text-sm text-[#8B9D94]">Choose a matrix backed by an available server endpoint.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link className="rounded-xl bg-[#00F77A] px-4 py-3 text-xs font-bold text-[#020705]" href="/matrix/x3">
            Open X3 Matrix
          </Link>
          <Link className="rounded-xl border border-[#00F77A]/20 px-4 py-3 text-xs text-[#00F77A]" href="/matrix/x4">
            Open X4 Matrix
          </Link>
        </div>
      </section>
    </Shell>
  );
}
