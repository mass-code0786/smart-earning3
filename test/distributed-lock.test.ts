import { describe, expect, it } from "vitest";
import { keeperLockName, sponsorLockName } from "@/lib/server/distributed-lock";

describe("distributed placement lock identities", () => {
  it("is stable across independently constructed service inputs", () => {
    const first = sponsorLockName(
      97,
      "0x00000000000000000000000000000000000000AA",
      "0x00000000000000000000000000000000000000BB",
    );
    const second = sponsorLockName(
      97,
      "0x00000000000000000000000000000000000000aa",
      "0x00000000000000000000000000000000000000bb",
    );
    expect(first).toBe(second);
  });

  it("allows different sponsors to have independent lock identities", () => {
    const contract = "0x00000000000000000000000000000000000000aa";
    expect(sponsorLockName(97, contract, "0x0000000000000000000000000000000000000001"))
      .not.toBe(sponsorLockName(97, contract, "0x0000000000000000000000000000000000000002"));
  });

  it("uses one keeper nonce lock across sponsors", () => {
    expect(keeperLockName(97, "0x00000000000000000000000000000000000000cc"))
      .toBe("placement:keeper-nonce:97:0x00000000000000000000000000000000000000cc");
  });
});
