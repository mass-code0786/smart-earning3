import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/page.tsx", "utf8");

describe("blockchain-neutral landing content", () => {
  it("uses inline Connect and Signup controls instead of landing navigation", () => {
    expect(source).toContain("<LandingActionButtons");
    expect(source).toContain("<LandingInlinePanel");
    expect(source).not.toContain('href="/login"');
    expect(source).not.toContain('href="/register"');
    expect(source).not.toContain("Wallet Login");
    expect(source).not.toContain("Wallet Registration");
  });

  it("contains the approved eight-package ladder", () => {
    expect(source).toContain("[8, 16, 32, 64, 128, 256, 512, 1024]");
  });

  it("uses the centered three-line journey hero", () => {
    expect(source).toContain("Your Journey Starts Here");
    expect(source).toContain("Build a Strong Global Network");
    expect(source).toContain("Achieve Financial Freedom Together.");
    expect(source).not.toContain("One premium view of a");
  });

  it("contains no displayed network or old starting-price references", () => {
    for (const forbidden of [
      "BNB Smart Chain", "BNB Chain", "Testnet", "Mainnet", "Chain ID",
      "Wallet signature required", "Built for the BNB Chain ecosystem",
      "Register with 2 USDT",
    ]) expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
  });
});
