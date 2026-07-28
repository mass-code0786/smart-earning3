import { AuthFrame } from "@/components/auth-frame";
import { RegistrationForm } from "@/components/registration-form";
import { registrationConfiguration } from "@/lib/server/config";
import { referralSponsorFromParam } from "@/lib/referral";

export default async function Page({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const configuration = registrationConfiguration();
  const initialSponsor = referralSponsorFromParam((await searchParams).ref);
  return (
    <AuthFrame
      title="Smart Earning Registration"
      copy="Register one wallet once with an existing sponsor. Activation occurs only after the BNB Testnet transaction is confirmed and verified."
    >
      <RegistrationForm registrationEnabled={configuration.enabled} initialSponsor={initialSponsor} />
    </AuthFrame>
  );
}
