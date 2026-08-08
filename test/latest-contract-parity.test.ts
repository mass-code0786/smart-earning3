// @vitest-environment node
import { Interface, id } from "ethers";
import { describe, expect, it, vi } from "vitest";
import artifact from "@/artifacts/contracts/SmartEarning.sol/SmartEarning.json";
import { PACKAGE_ABI, SMART_EARNING_ABI } from "@/lib/blockchain/abi";
import { alignDirectX3Rollout } from "@/lib/server/blockchain-indexer";

describe("latest deployed contract parity", () => {
  it("contains every repository-used function and every deployed event signature", () => {
    const deployed = new Interface(artifact.abi);
    const shared = new Interface([...SMART_EARNING_ABI, ...PACKAGE_ABI]);
    const deployedEvents = artifact.abi.filter(item => item.type === "event" && item.name).map(item => item.name!);
    for (const name of deployedEvents) {
      expect(shared.getEvent(name), `missing deployed event ${name}`).not.toBeNull();
    }
    for (const fragment of shared.fragments.filter(item => item.type === "function")) {
      expect(deployed.getFunction(fragment.format("sighash")), `stale ABI function ${fragment.format("sighash")}`)
        .not.toBeNull();
    }
    for (const name of ["register","purchasePackage","topupBooster","distributeBatch","fundMagic",
      "fundWithdrawalLiquidity","executeWithdrawal","advancePlacementCursor"]) {
      expect(shared.getFunction(name)?.selector).toBe(deployed.getFunction(name)?.selector);
    }
    expect(shared.getEvent("X4Placed")?.topicHash).toBe(deployed.getEvent("X4Placed")?.topicHash);
    expect(id("X4_GLOBAL")).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("aligns direct X3 to one block before the authoritative deployment", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    await expect(alignDirectX3Rollout(123687054, { query } as never)).resolves.toBe(true);
    expect(query.mock.calls[0][1]).toEqual([123687053]);
    expect(query.mock.calls[0][0]).toContain("mode='CONTRACT_ALIGNED'");
  });
});
