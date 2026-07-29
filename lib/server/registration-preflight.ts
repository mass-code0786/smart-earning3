import { getProvider } from "@/lib/blockchain/provider";
import { normalizeWallet } from "./auth";
import { CHAIN_ID, getServerConfig, ServerConfigError } from "./config";
import { DatabaseConnectionError, query } from "./db";
import { ApiError } from "./http";
import { ZodError } from "zod";

export type RegistrationStage = "PREPARATION" | "VERIFICATION";

export async function registrationPreflight(registrantInput: string, sponsorInput: string) {
  const registrant = normalizeWallet(registrantInput);
  let sponsor: string;
  try {
    sponsor = normalizeWallet(sponsorInput);
  } catch {
    throw new ApiError(422, "Sponsor wallet is not a valid EVM address", "INVALID_SPONSOR");
  }
  if (registrant === sponsor) {
    throw new ApiError(422, "Self-referral is not allowed", "INVALID_SPONSOR");
  }

  const state = await query<{
    registrant_active: boolean;
    sponsor_active: boolean;
    history_migration: boolean;
    history_table: boolean;
    history_trigger: boolean;
  }>(
    `SELECT
       EXISTS(SELECT 1 FROM users WHERE lower(wallet_address)=lower($1) AND status='ACTIVE') registrant_active,
       EXISTS(SELECT 1 FROM users WHERE lower(wallet_address)=lower($2) AND status='ACTIVE') sponsor_active,
       EXISTS(SELECT 1 FROM schema_migrations WHERE filename='022_activity_history.sql') history_migration,
       to_regclass('public.activity_history') IS NOT NULL history_table,
       to_regprocedure('write_activity_history_from_source()') IS NOT NULL history_trigger`,
    [registrant, sponsor],
  );
  const row = state.rows[0];
  if (row?.registrant_active) {
    throw new ApiError(409, "Wallet is already registered", "ALREADY_REGISTERED");
  }
  if (!row?.sponsor_active) {
    throw new ApiError(422, "Sponsor wallet is not active", "SPONSOR_NOT_ACTIVE");
  }
  if (!row.history_migration || !row.history_table || !row.history_trigger) {
    throw new ApiError(
      503,
      "Registration history dependency is not installed",
      "HISTORY_MIGRATION_MISSING",
    );
  }

  const config = getServerConfig();
  try {
    const provider = getProvider();
    const [network, contractCode, tokenCode] = await Promise.all([
      provider.getNetwork(),
      provider.getCode(config.SMART_EARNING_CONTRACT_ADDRESS),
      provider.getCode(config.BSC_TESTNET_USDT_ADDRESS),
    ]);
    if (Number(network.chainId) !== CHAIN_ID || CHAIN_ID !== 97) {
      throw new ApiError(422, "Registration network is not BNB Testnet", "WRONG_CHAIN");
    }
    if (contractCode === "0x" || tokenCode === "0x") {
      throw new ApiError(503, "Registration contracts are not configured", "CONTRACT_NOT_CONFIGURED");
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "Registration RPC is unavailable", "RPC_UNAVAILABLE");
  }
  return { registrant, sponsor };
}

export function safeRegistrationError(
  error: unknown,
  fallbackCode = "REGISTRATION_PREPARATION_FAILED",
) {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) {
    return new ApiError(400, "Registration request is invalid", "INVALID_REGISTRATION_REQUEST");
  }
  if (error instanceof ServerConfigError) {
    return new ApiError(503, "Registration service is not configured", "CONTRACT_NOT_CONFIGURED");
  }
  if (error instanceof DatabaseConnectionError) {
    const migration = error.databaseCode === "MIGRATION_MISSING";
    return new ApiError(
      503,
      migration ? "Required registration database migration is missing" : "Registration database is unavailable",
      migration ? "HISTORY_MIGRATION_MISSING" : "REGISTRATION_DATABASE_UNAVAILABLE",
    );
  }
  return new ApiError(
    503,
    fallbackCode === "REGISTRATION_VERIFICATION_FAILED"
      ? "Registration verification is temporarily unavailable"
      : "Registration service is temporarily unavailable",
    fallbackCode,
  );
}

export function logRegistrationFailure(input: {
  stage: RegistrationStage;
  error: ApiError;
  registrant?: string;
  sponsor?: string;
  endpoint: string;
}) {
  const suffix = (wallet?: string) => wallet && /^0x[a-fA-F0-9]{40}$/.test(wallet)
    ? `…${wallet.slice(-6).toLowerCase()}` : "unknown";
  console.error("[registration]", {
    stage: input.stage,
    code: input.error.code,
    registrant: suffix(input.registrant),
    sponsor: suffix(input.sponsor),
    endpoint: input.endpoint,
    message: input.error.message,
  });
}
