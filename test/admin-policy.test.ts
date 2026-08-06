import { afterEach, describe, expect, it } from "vitest";
import { assertConfiguredAdmin, configuredAdminWallets, isConfiguredAdmin } from "@/lib/server/admin-policy";

const original = process.env.ADMIN_WALLETS;
const admin = "0xf3a86386FE213901C8e02067c83B8cEb1f3aF508";

afterEach(() => { process.env.ADMIN_WALLETS = original; });

describe("canonical web admin policy", () => {
  it("normalizes the configured allowlist", () => {
    process.env.ADMIN_WALLETS = ` ${admin},${"0x" + "1".repeat(40)} `;
    expect(configuredAdminWallets()).toContain(admin.toLowerCase());
    expect(isConfiguredAdmin(admin.toLowerCase())).toBe(true);
  });

  it("fails closed for missing or malformed configuration", () => {
    delete process.env.ADMIN_WALLETS;
    expect(isConfiguredAdmin(admin)).toBe(false);
    process.env.ADMIN_WALLETS = "not-an-address";
    expect(isConfiguredAdmin(admin)).toBe(false);
    expect(() => assertConfiguredAdmin(admin)).toThrowError(/Administrator access required/);
  });

  it("does not grant access to an unlisted wallet", () => {
    process.env.ADMIN_WALLETS = admin;
    expect(isConfiguredAdmin("0x000000000000000000000000000000000000dEaD")).toBe(false);
  });
});
