// @vitest-environment node
import { Interface, ZeroAddress } from "ethers";
import { describe, expect, it } from "vitest";
import { PACKAGE_ABI, SMART_EARNING_ABI } from "@/lib/blockchain/abi";
import { decodedIndexerEventName } from "@/lib/server/blockchain-indexer";
import type { IndexerLog } from "@/scripts/indexer-core";

const iface = new Interface([...SMART_EARNING_ABI, ...PACKAGE_ABI]);
const transactionHash = `0x${"12".repeat(32)}`;
const address = "0x4509301aa843f504936999850f4bcaf57a03cd99";

function encoded(name: "UserRegistered" | "PackagePurchased"): IndexerLog {
  const values = name === "UserRegistered"
    ? [address, ZeroAddress, ZeroAddress, 1n, 0, 250_000n, 250_000n]
    : [address, 1, 1_000_000n, 1_000_000n, 5_000_000n, 1n];
  const entry = iface.encodeEventLog(iface.getEvent(name)!, values);
  return {
    address, blockNumber: 100, transactionHash, index: 1,
    topics: entry.topics, data: entry.data,
  };
}

describe("exact ABI event decoding", () => {
  it("recognizes UserRegistered and PackagePurchased only", () => {
    expect(decodedIndexerEventName(encoded("UserRegistered"))).toBe("UserRegistered");
    expect(decodedIndexerEventName(encoded("PackagePurchased"))).toBe("PackagePurchased");
    expect(decodedIndexerEventName({
      ...encoded("PackagePurchased"), topics: [`0x${"00".repeat(32)}`],
    })).toBeUndefined();
  });
});
