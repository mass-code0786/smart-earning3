// @vitest-environment node
import { Interface } from "ethers";
import { describe, expect, it } from "vitest";
import { SMART_EARNING_ABI } from "@/lib/blockchain/abi";
import { decodedIndexerEventName } from "@/lib/server/blockchain-indexer";

const iface = new Interface(SMART_EARNING_ABI);
const contract = "0xe8849043da1b0105f13cBDadE8471D82E1847876";
const user = "0x00000000000000000000000000000000000000A1";
const sponsor = "0x00000000000000000000000000000000000000b2";
const matrixParent = "0x00000000000000000000000000000000000000C3";

describe("current-contract registration verifier ABI", () => {
  it("decodes the exact current UserRegistered event shape by its deployed argument names", () => {
    const encoded = iface.encodeEventLog(iface.getEvent("UserRegistered")!, [
      user, sponsor, matrixParent, 42n, 1, 750_000n, 1_000_000n,
    ]);
    const parsed = iface.parseLog(encoded);

    expect(parsed?.name).toBe("UserRegistered");
    expect(String(parsed?.args.user).toLowerCase()).toBe(user.toLowerCase());
    expect(String(parsed?.args.sponsor).toLowerCase()).toBe(sponsor.toLowerCase());
    expect(String(parsed?.args.matrixParent).toLowerCase()).toBe(matrixParent.toLowerCase());
    expect(parsed?.args.matrixIndex).toBe(42n);
    expect(parsed?.args.matrixPosition).toBe(1n);
    expect(parsed?.args.directSponsorIncome).toBe(750_000n);
    expect(parsed?.args.magicWalletCredit).toBe(1_000_000n);

    expect(decodedIndexerEventName({
      address: contract,
      blockNumber: 123_700_000,
      transactionHash: `0x${"12".repeat(32)}`,
      index: 7,
      topics: encoded.topics,
      data: encoded.data,
    })).toBe("UserRegistered");
  });

  it("encodes both verifier sponsor-state reads from the shared current ABI", () => {
    expect(iface.encodeFunctionData("totalPackageValue", [sponsor]))
      .toMatch(/^0x[0-9a-f]{72}$/);
    expect(iface.encodeFunctionData("totalEarningCap", [sponsor]))
      .toMatch(/^0x[0-9a-f]{72}$/);
  });

  it("reproduces the production ethers INVALID_ARGUMENT when the missing getter is removed", () => {
    const staleAbi = SMART_EARNING_ABI.filter(fragment =>
      fragment !== "function totalPackageValue(address) view returns (uint256)");
    const staleInterface = new Interface(staleAbi);

    expect(() => staleInterface.encodeFunctionData("totalPackageValue", [sponsor]))
      .toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT", name: "TypeError" }));
  });
});
