"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { SmartEarningPageShell } from "@/components/smart-earning-shell";

export function MetaverseBackground() {
  return (
    <div className="fixed-metaverse-background" aria-hidden>
      <Image
        src="/images/smart-earning-metaverse-man.png"
        alt=""
        fill
        priority
        sizes="100vw"
        draggable={false}
      />
      <div className="fixed-metaverse-overlay" />
    </div>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center" aria-label="Smart Earning home">
      <Image
        src="/logo.png"
        alt="Smart Earning"
        width={220}
        height={147}
        priority
        className="h-auto w-[156px] object-contain"
      />
    </Link>
  );
}

export function GlassCard({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      className={`glass rounded-[22px] ${className}`}
    >
      {children}
    </motion.section>
  );
}

export function StatusBadge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex rounded-full border border-gold/25 bg-gold/10 px-2 py-1 text-[10px] font-semibold text-gold">{children}</span>;
}

export function SectionTitle({
  eyebrow,
  title,
}: {
  eyebrow?: string;
  title: string;
}) {
  return (
    <div className="mb-4 mt-9">
      {eyebrow && <p className="mb-1 text-[10px] uppercase tracking-[.24em] text-gold/70">{eyebrow}</p>}
      <h2 className="text-xl font-semibold sm:text-2xl">{title}</h2>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return <SmartEarningPageShell>{children}</SmartEarningPageShell>;
}
