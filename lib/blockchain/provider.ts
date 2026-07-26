import { Contract, JsonRpcProvider } from "ethers";
import { CHAIN_ID, getServerConfig } from "@/lib/server/config";
import { PACKAGE_ABI, SMART_EARNING_ABI } from "./abi";

let provider: JsonRpcProvider | undefined;

export function getProvider() {
  if (!provider) {
    provider = new JsonRpcProvider(getServerConfig().BSC_TESTNET_RPC_URL, CHAIN_ID, {
      staticNetwork: true,
    });
  }
  return provider;
}

export function getSmartEarningContract() {
  return new Contract(
    getServerConfig().SMART_EARNING_CONTRACT_ADDRESS,
    SMART_EARNING_ABI,
    getProvider(),
  );
}

export function getPackageContract() {
  return new Contract(
    getServerConfig().SMART_EARNING_CONTRACT_ADDRESS,
    PACKAGE_ABI,
    getProvider(),
  );
}
