import { describe, expect, it } from "vitest";
import { normalizeWallet } from "@/lib/server/auth";
import { calculateCappedCredit } from "@/lib/server/income-cap-service";
import { Interface } from "ethers";
import { SMART_EARNING_ABI } from "@/lib/blockchain/abi";
import { ensureRegistrationPlacement } from "@/lib/server/placement-service";

describe("wallet authentication normalization", () => {
  it("normalizes a valid signed-wallet address and rejects malformed input", () => {
    const wallet = "0x000000000000000000000000000000000000dEaD";
    expect(normalizeWallet(wallet)).toBe(wallet.toLowerCase());
    expect(() => normalizeWallet("not-a-wallet")).toThrow("Invalid wallet address");
  });
});

describe("central earning cap",()=>{
  it("credits only the remaining amount and preserves excess",()=>{
    const result=calculateCappedCredit(50_000_000n,49_970_000n,50_000n);
    expect(result.credited).toBe(30_000n);
    expect(result.excess).toBe(20_000n);
    expect(result.remainingAfter).toBe(0n);
    expect(result.status).toBe("CAPPED");
  });
  it("reactivates capacity when the cap expands",()=>{
    const result=calculateCappedCredit(130_000_000n,40_000_000n,1_000_000n);
    expect(result.credited).toBe(1_000_000n);
    expect(result.remainingAfter).toBe(89_000_000n);
    expect(result.status).toBe("ACTIVE");
  });
});

describe("automatic placement preparation", () => {
  it("keeper advances and retries without asking the registering wallet", async () => {
    const iface = new Interface(SMART_EARNING_ABI);
    const data = iface.encodeErrorResult("PlacementSearchNeedsAdvance", [
      "0x0000000000000000000000000000000000000002", 64n,
    ]);
    let simulations = 0;
    const advances: bigint[] = [];
    const result = await ensureRegistrationPlacement(
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000002",
      {
        isRegistered: async (wallet) => wallet.endsWith("2"),
        simulateRegistration: async () => {
          if (simulations++ < 2) throw { data };
        },
        advance: async (_sponsor, steps) => {
          advances.push(steps);
          return `0x${String(advances.length).padStart(64, "0")}`;
        },
      },
    );
    expect(advances).toEqual([256n, 256n]);
    expect(result.ready).toBe(true);
    expect(result.advancementTransactions).toHaveLength(2);
  });

  it("does not advance for an already-ready registration", async () => {
    let advances = 0;
    await ensureRegistrationPlacement(
      "0x0000000000000000000000000000000000000003",
      "0x0000000000000000000000000000000000000004",
      {
        isRegistered: async (wallet) => wallet.endsWith("4"),
        simulateRegistration: async () => undefined,
        advance: async () => { advances++; return `0x${"1".repeat(64)}`; },
      },
    );
    expect(advances).toBe(0);
  });
});
