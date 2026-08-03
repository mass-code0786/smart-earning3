import { Shell } from "@/components/ui";
import { PageHero } from "@/components/page-sections";
import { MagicPlanLive } from "@/components/live-plan-data";

export default function Page() {
  return <Shell><PageHero title="Magic Level" copy="20 levels with permanent 1 × 2 BFS spillover placement and verified daily USDT distribution records."/><div className="mt-4"><MagicPlanLive/></div></Shell>;
}
