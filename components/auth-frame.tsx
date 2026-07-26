import { GlassCard, Logo, MetaverseBackground } from "@/components/ui";

export function AuthFrame({
  title,
  copy,
  children,
}: {
  title: string;
  copy: string;
  children: React.ReactNode;
}) {
  return (
    <div className="public-theme auth-theme fixed-background-shell">
      <MetaverseBackground />
      <div className="auth-frame">
        <GlassCard className="auth-card">
          <Logo />
          <h1>{title}</h1>
          <p className="auth-copy">{copy}</p>
          {children}
          <p className="auth-footnote">
            BNB Smart Chain Testnet · Gas is always paid separately in BNB
          </p>
        </GlassCard>
      </div>
    </div>
  );
}
