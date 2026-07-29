import { ChevronRight, Network, ShieldCheck, Zap } from "lucide-react";
import { GlassCard, Logo, MetaverseBackground, SectionTitle } from "@/components/ui";
import { LandingActionButtons, LandingInlinePanel, LandingInteractionProvider } from "@/components/landing-interactions";
import { registrationConfiguration } from "@/lib/server/config";
import { referralSponsorFromParam } from "@/lib/referral";

const modules = [
  ["Working X3 Matrix", "Package-based X3 placement, hold and recycle records."],
  ["X4 Matrix", "Package-based X4 placement and earning records."],
  ["Magic Matrix", "Qualified level distribution backed by verified ledger records."],
  ["Smart Packages", "Eight sequential package levels."],
  ["Booster", "Automated entries funded through Booster Wallet."],
  ["Global Autopool", "Autopool access when verified backend records are available."],
  ["Daily Dividend", "Dividend access when verified backend records are available."],
] as const;

const packages = [8, 16, 32, 64, 128, 256, 512, 1024].map((price, index) => ({
  id: index + 1,
  price,
}));

export default async function Page({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const initialSponsor = referralSponsorFromParam((await searchParams).ref);
  const registrationEnabled = registrationConfiguration().enabled;
  const steps: [string, typeof ShieldCheck][] = [
    ["Connect your wallet", ShieldCheck],
    ["Choose your package", ChevronRight],
    ["Access Smart Earning", Network],
  ];

  return (
    <LandingInteractionProvider initialSponsor={initialSponsor} registrationEnabled={registrationEnabled}><div className="public-theme fixed-background-shell min-h-screen">
      <MetaverseBackground />
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-4 py-5">
        <Logo />
        <LandingActionButtons compact />
      </header>

      <main className="relative z-[2] mx-auto max-w-7xl px-4 pb-20">
        <section className="grid min-h-[75vh] items-center py-16 lg:grid-cols-2">
          <div className="text-center">
            <h1 className="landing-journey-heading">
              <span>Your Journey Starts Here</span>
              <strong>Build a Strong Global Network</strong>
              <span>Achieve Financial Freedom Together.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base leading-7 text-white/50">
              Connect your wallet to access matrix, autopool, booster, dividend and level modules.
              Potential rewards depend on platform rules.
            </p>
            <LandingActionButtons />
          </div>
          <div className="relative hidden lg:block">
            <div className="mx-auto grid h-80 w-80 place-items-center rounded-full border border-gold/20">
              <div className="grid h-56 w-56 place-items-center rounded-full border border-dashed border-gold/40">
                <span className="grid h-28 w-28 place-items-center rounded-full bg-gold/10 text-4xl font-black gold-text">SE</span>
              </div>
            </div>
          </div>
        </section>
        <LandingInlinePanel initialSponsor={initialSponsor} registrationEnabled={registrationEnabled}/>

        <div className="text-center">
          <SectionTitle eyebrow="Platform ecosystem" title="Six modules. One focused workspace." />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {modules.map(([name, description], index) => (
            <GlassCard className="flex min-h-[78px] items-center gap-3 px-4 py-2.5" key={name}>
              <span className="shrink-0 text-gold">{index % 2 ? <Network /> : <Zap />}</span>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-white">{name}</h3>
                <p className="mt-1 text-xs leading-4 text-white/75">{description}</p>
              </div>
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
            <GlassCard className="flex min-h-[78px] items-center gap-3 overflow-hidden px-4 py-3 sm:px-5" key={label}>
              <Icon className="shrink-0 text-gold" />
              <span className="shrink-0 text-xs font-semibold text-white/90">0{index + 1}</span>
              <h3 className="min-w-0 whitespace-nowrap text-sm font-semibold text-white sm:text-base">{label}</h3>
            </GlassCard>
          ))}
        </section>

        <GlassCard className="p-8 text-center sm:p-12">
          <h2 className="text-3xl font-semibold">Enter Smart Earning</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/45">
            Existing members can connect securely. New members can create their Smart Earning account.
          </p>
          <div className="mx-auto max-w-[280px]"><LandingActionButtons /></div>
        </GlassCard>
      </main>

      <footer className="relative z-[2] border-t border-white/10 px-4 py-8 text-center text-xs text-white/35">
        © Smart Earning
      </footer>
    </div></LandingInteractionProvider>
  );
}
