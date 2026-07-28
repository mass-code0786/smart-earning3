import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/page.tsx", "utf8");

describe("blockchain-neutral landing content", () => {
  it("keeps wallet routes while presenting Connect and Signup", () => {
    expect(source).toContain('href="/login"');
    expect(source).toContain('href="/register"');
    expect(source).not.toContain("Wallet Login");
    expect(source).not.toContain("Wallet Registration");
  });

  it("contains the approved eight-package ladder", () => {
    expect(source).toContain("[8, 16, 32, 64, 128, 256, 512, 1024]");
  });

  it("contains no displayed network or old starting-price references", () => {
    for (const forbidden of [
      "BNB Smart Chain", "BNB Chain", "Testnet", "Mainnet", "Chain ID",
      "Wallet signature required", "Built for the BNB Chain ecosystem",
      "Register with 2 USDT",
    ]) expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
  });
});
