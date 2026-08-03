import { Shell } from "@/components/ui";
import { CompactPageTitle } from "@/components/page-sections";
import { MagicPlanLive } from "@/components/live-plan-data";

export default function Page() {
  return <Shell><CompactPageTitle title="Magic Level"/><div className="mt-3"><MagicPlanLive/></div></Shell>;
}
