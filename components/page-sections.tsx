import { GlassCard, StatusBadge } from "@/components/ui";

export function PageHero({ title, copy }: { title: string; copy: string }) {
  return (
    <GlassCard className="overflow-hidden p-6 sm:p-9">
      <StatusBadge>{process.env.NEXT_PUBLIC_NETWORK_NAME || "Smart Earning Network"}</StatusBadge>
      <h1 className="mt-4 text-3xl font-semibold sm:text-4xl">{title}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-white/50">{copy}</p>
    </GlassCard>
  );
}

export function CompactPageTitle({ title }: { title: string }) {
  return <GlassCard className="px-4 py-3 sm:px-5 sm:py-4"><h1 className="text-lg font-semibold sm:text-xl">{title}</h1></GlassCard>;
}
