// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertSessionWallet } from "@/lib/server/auth";
import { referralSponsorFromParam } from "@/lib/referral";

const walletA = "0x00000000000000000000000000000000000000aa";
const walletB = "0x00000000000000000000000000000000000000bb";

describe("wallet and referral session isolation", () => {
  it("rejects a stale Wallet A session when Wallet B is connected", () => {
    expect(() => assertSessionWallet(walletA, walletB)).toThrowError(
      expect.objectContaining({
        status: 401,
        code: "SESSION_WALLET_MISMATCH",
        message: "Wallet session mismatch",
      }),
    );
  });

  it("accepts only the same normalized connected and session wallet", () => {
    expect(() => assertSessionWallet(walletA.toUpperCase().replace("0X", "0x"), walletA))
      .not.toThrow();
  });

  it("keeps a referral parameter as sponsor data and never session data", () => {
    expect(referralSponsorFromParam(walletA)).toBe(walletA);
    expect(referralSponsorFromParam(`${walletA}?wallet=${walletB}`)).toBe("");
  });
});
