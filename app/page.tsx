import Link from "next/link";
import { ChevronRight, Network, ShieldCheck, Zap } from "lucide-react";
import { GlassCard, Logo, MetaverseBackground, SectionTitle } from "@/components/ui";

const modules = [
  ["Working X3 Matrix", "Package-based X3 placement, hold and recycle records."],
  ["Magic Matrix", "Qualified level distribution backed by verified ledger records."],
  ["Smart Packages", "Eight sequential BNB Testnet package levels."],
  ["Booster", "Automated entries funded through Booster Wallet."],
  ["Global Autopool", "Autopool access when verified backend records are available."],
  ["Daily Dividend", "Dividend access when verified backend records are available."],
] as const;

const packages = [2, 4, 8, 16, 32, 64, 128, 256].map((price, index) => ({
  id: index + 1,
  price,
}));

export default function Page() {
  const steps: [string, typeof ShieldCheck][] = [
    ["Connect a BNB Testnet wallet", ShieldCheck],
    ["Register with 2 USDT", ChevronRight],
    ["Access Smart Earning", Network],
  ];

  return (
    <div className="public-theme fixed-background-shell min-h-screen">
      <MetaverseBackground />
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-4 py-5">
        <Logo />
        <div className="flex gap-2">
          <Link className="rounded-xl px-4 py-2 text-xs text-white/60" href="/login">
            Login
          </Link>
          <Link className="rounded-xl bg-gold px-4 py-2 text-xs font-bold text-black" href="/register">
            Register
          </Link>
        </div>
      </header>

      <main className="relative z-[2] mx-auto max-w-7xl px-4 pb-20">
        <section className="grid min-h-[75vh] items-center py-16 lg:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-[.3em] text-gold">Built for the BNB Chain ecosystem</p>
            <h1 className="mt-5 text-5xl font-semibold leading-[1.05] sm:text-7xl">
              One premium view of a <span className="gold-text">connected ecosystem.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-white/50">
              Connect your wallet to access matrix, autopool, booster, dividend and level modules.
              Potential rewards depend on platform rules.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link className="rounded-xl bg-gold px-5 py-3 text-sm font-bold text-black" href="/login">
                Wallet Login
              </Link>
              <Link className="rounded-xl border border-gold/25 px-5 py-3 text-sm text-gold" href="/register">
                Wallet Registration
              </Link>
            </div>
            <p className="mt-4 text-[11px] text-white/35">BNB Smart Chain Testnet · Wallet signature required</p>
          </div>
          <div className="relative hidden lg:block">
            <div className="mx-auto grid h-80 w-80 place-items-center rounded-full border border-gold/20">
              <div className="grid h-56 w-56 place-items-center rounded-full border border-dashed border-gold/40">
                <span className="grid h-28 w-28 place-items-center rounded-full bg-gold/10 text-4xl font-black gold-text">SE</span>
              </div>
            </div>
          </div>
        </section>

        <SectionTitle eyebrow="Platform ecosystem" title="Six modules. One focused workspace." />
        <div className="grid gap-3 md:grid-cols-3">
          {modules.map(([name, description], index) => (
            <GlassCard className="p-5" key={name}>
              <span className="text-gold">{index % 2 ? <Network /> : <Zap />}</span>
              <h3 className="mt-5 font-semibold">{name}</h3>
              <p className="mt-2 text-xs leading-5 text-white/45">{description}</p>
            </GlassCard>
          ))}
        </div>

        <SectionTitle eyebrow="Sequential plan" title="Smart Packages" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {packages.map((item) => (
            <GlassCard className="p-5" key={item.id}>
              <p className="text-xs text-white/40">Package {item.id}</p>
              <b className="mt-2 block text-2xl">${item.price}</b>
            </GlassCard>
          ))}
        </div>

        <section className="grid gap-4 py-20 md:grid-cols-3">
          {steps.map(([label, Icon], index) => (
            <GlassCard className="p-6" key={label}>
              <Icon className="text-gold" />
              <p className="mt-4 text-xs text-white/35">0{index + 1}</p>
              <h3 className="mt-1">{label}</h3>
            </GlassCard>
          ))}
        </section>

        <GlassCard className="p-8 text-center sm:p-12">
          <h2 className="text-3xl font-semibold">Enter Smart Earning</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/45">
            Existing members sign a nonce. New members register on BNB Testnet with 2 USDT.
          </p>
          <Link className="mt-6 inline-block rounded-xl bg-gold px-6 py-3 text-sm font-bold text-black" href="/login">
            Connect Wallet
          </Link>
        </GlassCard>
      </main>

      <footer className="relative z-[2] border-t border-white/10 px-4 py-8 text-center text-xs text-white/35">
        © Smart Earning · BNB Smart Chain Testnet
      </footer>
    </div>
  );
}
