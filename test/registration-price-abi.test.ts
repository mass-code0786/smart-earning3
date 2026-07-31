// @vitest-environment node
import { Contract, Interface } from "ethers";
import { describe, expect, it } from "vitest";
import { SMART_EARNING_ABI } from "@/lib/blockchain/abi";

describe("registration price contract wrapper", () => {
  it("keeps the registrationPrice getter in the server contract ABI", () => {
    const fragment = new Interface(SMART_EARNING_ABI).getFunction("registrationPrice");

    expect(fragment?.stateMutability).toBe("view");
    expect(fragment?.inputs).toHaveLength(0);
    expect(fragment?.outputs[0]?.type).toBe("uint256");
  });

  it("exposes registrationPrice as an ethers v6 contract method", () => {
    const contract = new Contract(
      "0x0000000000000000000000000000000000000001",
      SMART_EARNING_ABI,
    );

    expect(typeof contract.registrationPrice).toBe("function");
  });
});
