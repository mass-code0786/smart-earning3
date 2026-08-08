// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import deployment from "@/deployments/bsc-testnet.json";

const require = createRequire(import.meta.url);
const { authoritativeDeploymentEnvironment } = require("../scripts/deployment-environment.cjs");

describe("deployment-derived runtime environment", () => {
  it("fills all duplicated contract identity values from tracked metadata", () => {
    expect(authoritativeDeploymentEnvironment({ DATABASE_URL: "postgresql://local/db" }))
      .toMatchObject({
        SMART_EARNING_CHAIN_ID: String(deployment.chainId),
        SMART_EARNING_CONTRACT_ADDRESS: deployment.address,
        NEXT_PUBLIC_SMART_EARNING_CONTRACT_ADDRESS: deployment.address,
        BSC_TESTNET_USDT_ADDRESS: deployment.usdt,
        GENESIS_WALLET: deployment.genesis,
      });
  });

  it("refuses stale PM2 or env-file deployment state", () => {
    expect(() => authoritativeDeploymentEnvironment({
      SMART_EARNING_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
    })).toThrow("SMART_EARNING_CONTRACT_ADDRESS");
    expect(() => authoritativeDeploymentEnvironment({ SMART_EARNING_DEPLOYMENT_BLOCK: "1" }))
      .toThrow("SMART_EARNING_DEPLOYMENT_BLOCK");
  });
});
