import { DirectIncomeLive } from "@/components/live-plan-data";
import { SmartEarningPageShell } from "@/components/smart-earning-shell";
import { WithdrawalStatus } from "@/components/withdrawal-status";

export default function Page() {
  return <SmartEarningPageShell><DirectIncomeLive /><WithdrawalStatus /></SmartEarningPageShell>;
}
