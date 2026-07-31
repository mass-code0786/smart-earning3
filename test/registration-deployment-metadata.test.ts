// @vitest-environment node
import { describe, expect, it } from "vitest";
import deployment from "@/deployments/bsc-testnet.json";
import { smartEarningDeployment } from "@/lib/blockchain/deployment-metadata";

describe("authoritative registration deployment metadata", () => {
  it("contains the complete deterministic deployment identity", () => {
    expect(deployment).toMatchObject({
      chainId: 97,
      address: expect.stringMatching(/^0x[0-9a-f]{40}$/i),
      txHash: expect.stringMatching(/^0x[0-9a-f]{64}$/i),
      blockNumber: expect.any(Number),
    });
    expect(smartEarningDeployment({})).toMatchObject({
      chainId: deployment.chainId,
      address: deployment.address.toLowerCase(),
      txHash: deployment.txHash.toLowerCase(),
      blockNumber: deployment.blockNumber,
    });
  });

  it("rejects conflicting environment configuration", () => {
    expect(() => smartEarningDeployment({ SMART_EARNING_CHAIN_ID: "56" }))
      .toThrow("SMART_EARNING_CHAIN_ID");
    expect(() => smartEarningDeployment({
      SMART_EARNING_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
    })).toThrow("SMART_EARNING_CONTRACT_ADDRESS");
    expect(() => smartEarningDeployment({ SMART_EARNING_DEPLOYMENT_BLOCK: "1" }))
      .toThrow("SMART_EARNING_DEPLOYMENT_BLOCK");
  });

  it("keeps production and disposable E2E metadata isolated", () => {
    const local = {
      chainId: 31337,
      address: "0x0000000000000000000000000000000000003133",
      txHash: `0x${"31".repeat(32)}`,
      blockNumber: 2,
      genesis: "0x0000000000000000000000000000000000000002",
    };
    expect(smartEarningDeployment({
      SMART_EARNING_CHAIN_ID: String(deployment.chainId),
      SMART_EARNING_CONTRACT_ADDRESS: deployment.address,
    })).toMatchObject({
      chainId: deployment.chainId,
      address: deployment.address.toLowerCase(),
    });
    expect(smartEarningDeployment({
      LOCAL_E2E: "true",
      LOCAL_E2E_DEPLOYMENT_METADATA: JSON.stringify(local),
      SMART_EARNING_CHAIN_ID: String(local.chainId),
      SMART_EARNING_CONTRACT_ADDRESS: local.address,
      SMART_EARNING_DEPLOYMENT_BLOCK: String(local.blockNumber),
    })).toEqual({
      ...local,
      address: local.address.toLowerCase(),
      txHash: local.txHash.toLowerCase(),
      genesis: local.genesis.toLowerCase(),
    });
    expect(() => smartEarningDeployment({
      LOCAL_E2E_DEPLOYMENT_METADATA: JSON.stringify(local),
    })).toThrow("only allowed when LOCAL_E2E=true");
  });
});
