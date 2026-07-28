import { Interface } from "ethers";
import { z } from "zod";
import { SMART_EARNING_ABI } from "@/lib/blockchain/abi";
import { getProvider } from "@/lib/blockchain/provider";
import { normalizeWallet } from "./auth";
import { CHAIN_ID, getServerConfig } from "./config";
import { ApiError } from "./http";
import { verifyAndActivateRegistration } from "./registration-service";

const txHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const iface = new Interface(SMART_EARNING_ABI);

type ExactTransactionProvider = {
  getNetwork(): Promise<{ chainId: bigint | number }>;
  getTransaction(txHash: string): Promise<{
    from: string;
    to: string | null;
    data: string;
  } | null>;
  getTransactionReceipt(txHash: string): Promise<{
    status: number | null;
    to: string | null;
    logs: ReadonlyArray<{
      address: string;
      topics: readonly string[];
      data: string;
    }>;
  } | null>;
};

type RegistrationVerifier = (
  wallet: string,
  txHash: string,
) => Promise<{ registrationId: string; status: string; duplicate: boolean }>;

export async function reconcileRegistrationTransaction(
  txHashInput: string,
  dependencies: {
    provider?: ExactTransactionProvider;
    verifyRegistration?: RegistrationVerifier;
    contractAddress?: string;
  } = {},
) {
  const txHash = txHashSchema.parse(txHashInput).toLowerCase();
  const provider = dependencies.provider ?? getProvider();
  const contractAddress = normalizeWallet(
    dependencies.contractAddress ?? getServerConfig().SMART_EARNING_CONTRACT_ADDRESS,
  );
  const [network, transaction, receipt] = await Promise.all([
    provider.getNetwork(),
    provider.getTransaction(txHash),
    provider.getTransactionReceipt(txHash),
  ]);

  if (Number(network.chainId) !== CHAIN_ID || CHAIN_ID !== 97) {
    throw new ApiError(503, "RPC is not connected to BNB Testnet", "WRONG_RPC_NETWORK");
  }
  if (!transaction || !receipt) {
    throw new ApiError(404, "Registration transaction was not found", "TX_NOT_FOUND");
  }
  if (receipt.status !== 1) {
    throw new ApiError(422, "Registration transaction failed", "TX_REVERTED");
  }
  if (
    normalizeWallet(transaction.to || "") !== contractAddress
    || normalizeWallet(receipt.to || "") !== contractAddress
  ) {
    throw new ApiError(422, "Transaction targets another contract", "WRONG_CONTRACT");
  }

  let decoded;
  try {
    decoded = iface.parseTransaction({ data: transaction.data });
  } catch {
    decoded = null;
  }
  if (!decoded || decoded.name !== "register") {
    throw new ApiError(422, "Transaction is not a registration", "WRONG_METHOD");
  }
  const intendedWallet = normalizeWallet(transaction.from);
  const intendedSponsor = normalizeWallet(String(decoded.args.sponsor));

  const registrationEvent = receipt.logs
    .filter((log) => normalizeWallet(log.address) === contractAddress)
    .map((log) => {
      try {
        return iface.parseLog({ topics: log.topics, data: log.data });
      } catch {
        return null;
      }
    })
    .find((event) => event?.name === "UserRegistered");
  if (!registrationEvent) {
    throw new ApiError(422, "UserRegistered event was not found", "EVENT_NOT_FOUND");
  }

  const eventWallet = normalizeWallet(String(registrationEvent.args.user));
  const eventSponsor = normalizeWallet(String(registrationEvent.args.sponsor));
  if (eventWallet !== intendedWallet) {
    throw new ApiError(403, "Registration event belongs to another wallet", "WALLET_MISMATCH");
  }
  if (eventSponsor !== intendedSponsor) {
    throw new ApiError(422, "Registration sponsor does not match transaction", "SPONSOR_MISMATCH");
  }

  const result = await (dependencies.verifyRegistration ?? verifyAndActivateRegistration)(
    intendedWallet,
    txHash,
  );
  return {
    txHash,
    wallet: intendedWallet,
    sponsor: eventSponsor,
    registrationId: result.registrationId,
    status: result.status,
    alreadyReconciled: result.duplicate,
  };
}
