import { AuthFrame } from "@/components/auth-frame";
import { RegistrationForm } from "@/components/registration-form";
import { registrationConfiguration } from "@/lib/server/config";

export default function Page() {
  const configuration = registrationConfiguration();
  return (
    <AuthFrame
      title="Smart Earning Registration"
      copy="Register one wallet once with an existing sponsor. Activation occurs only after the BNB Testnet transaction is confirmed and verified."
    >
      <RegistrationForm registrationEnabled={configuration.enabled} />
    </AuthFrame>
  );
}
