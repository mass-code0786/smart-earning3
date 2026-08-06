// @vitest-environment node
import { Contract, Interface } from "ethers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("avoids historical RPC reads after validating the canonical registration event", () => {
    const service = readFileSync(resolve("lib/server/registration-service.ts"), "utf8");
    expect(service).toContain("registrationPrice = magicCredit * 2n");
    expect(service).toContain("registrationContract.getTotalEarningCap(sponsor)");
    expect(service).not.toContain("blockTag: receipt.blockNumber");
    expect(service).toContain('"[registration:blockchain-call]"');
    expect(service).toContain('functionName: "getTotalEarningCap(address)"');
    expect(service).toContain("revertData:");
  });
});
