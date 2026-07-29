import { redirect } from "next/navigation";
import { referralSponsorFromParam } from "@/lib/referral";

export default async function Page({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const sponsor = referralSponsorFromParam((await searchParams).ref);
  redirect(sponsor ? `/?ref=${encodeURIComponent(sponsor)}` : "/");
}
