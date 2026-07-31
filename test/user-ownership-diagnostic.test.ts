// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Interface } from "ethers";
import { SMART_EARNING_ABI } from "@/lib/blockchain/abi";

describe("user ownership diagnostic safety", () => {
  it("is structurally read-only and requires explicit sponsor/referral parameters", () => {
    const service = readFileSync(resolve("lib/server/user-ownership-diagnostic.ts"), "utf8");
    const script = readFileSync(resolve("scripts/diagnose-user-ownership.ts"), "utf8");
    expect(service).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|TRUNCATE|DROP)\b/i);
    expect(service).not.toMatch(/sendTransaction|new\s+Wallet|\.register\s*\(/);
    expect(script).toContain('argument("sponsor")');
    expect(script).toContain('argument("referral")');
    expect(service).toContain('mode: "READ_ONLY"');
  });

  it("uses the exact UserRegistered ABI order", () => {
    const iface = new Interface(SMART_EARNING_ABI);
    const event = iface.getEvent("UserRegistered")!;
    expect(event.inputs.map((input) => ({
      name: input.name, indexed: input.indexed, type: input.type,
    }))).toEqual([
      { name: "user", indexed: true, type: "address" },
      { name: "sponsor", indexed: true, type: "address" },
      { name: "matrixParent", indexed: true, type: "address" },
      { name: "matrixIndex", indexed: null, type: "uint256" },
      { name: "matrixPosition", indexed: null, type: "uint8" },
      { name: "directSponsorIncome", indexed: null, type: "uint256" },
      { name: "magicWalletCredit", indexed: null, type: "uint256" },
    ]);
  });

  it("discovers all candidate hashes before enforcing the single-event gate", () => {
    const service = readFileSync(resolve("lib/server/user-ownership-diagnostic.ts"), "utf8");
    expect(service).toContain('addCandidate(row.tx_hash, "registration tx hash")');
    expect(service).toContain('addCandidate(row.tx_hash, "blockchain_transactions")');
    expect(service).toContain(
      'addCandidate(row.transaction_hash, "processed blockchain events")',
    );
    expect(service).toContain("decodedUserRegisteredEvents.push");
    expect(service).toContain("confirmedMatchingEvents.length === 1");
  });

  it("registration projection keeps registered and sponsor IDs in distinct positions", () => {
    const source = readFileSync(resolve("lib/server/registration-service.ts"), "utf8");
    expect(source).toContain("[userId, sponsorUserId, txHash");
    expect(source).toContain("[userId, sponsorUserId, registrationId]");
    expect(source).toContain("userId: sponsorUserId");
    expect(source).toContain("[userId, registrationId, magicCredit.toString()");
  });
});
