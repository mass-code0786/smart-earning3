import { ZodError } from "zod";
import { getProvider } from "@/lib/blockchain/provider";
import { normalizeWallet } from "./auth";
import { CHAIN_ID, getServerConfig, ServerConfigError } from "./config";
import { DatabaseConnectionError, query } from "./db";
import { ApiError } from "./http";
import { requireRegistrationSchemaReady } from "./registration-schema-readiness";

export type RegistrationStage =
  | "CHECK_REGISTRANT" | "CHECK_SPONSOR" | "CHECK_HISTORY_MIGRATION"
  | "CHECK_HISTORY_OBJECTS" | "CHECK_RPC" | "CHECK_CONTRACTS"
  | "ENSURE_PLACEMENT" | "PREPARE_RESPONSE" | "VERIFICATION";

export class RegistrationStageFailure extends Error {
  constructor(public readonly stage: RegistrationStage, public readonly original: unknown) {
    super(original instanceof Error ? original.message : "Registration stage failed");
    this.name = "RegistrationStageFailure";
  }
}

async function atStage<T>(stage: RegistrationStage, operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    throw new RegistrationStageFailure(stage, error);
  }
}

export async function registrationPreflight(registrantInput: string, sponsorInput: string) {
  const registrant = await atStage("CHECK_REGISTRANT", async () => normalizeWallet(registrantInput));
  const sponsor = await atStage("CHECK_SPONSOR", async () => {
    let normalized: string;
    try {
      normalized = normalizeWallet(sponsorInput);
    } catch {
      throw new ApiError(422, "Sponsor wallet is not a valid EVM address", "INVALID_SPONSOR");
    }
    if (registrant === normalized) {
      throw new ApiError(422, "Self-referral is not allowed", "INVALID_SPONSOR");
    }
    return normalized;
  });

  const registrantState = await atStage("CHECK_REGISTRANT", () => query<{ active: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM users WHERE lower(wallet_address)=lower($1) AND status='ACTIVE'
     ) active`,
    [registrant],
  ));
  if (registrantState.rows[0]?.active) {
    throw new RegistrationStageFailure(
      "CHECK_REGISTRANT",
      new ApiError(409, "Wallet is already registered", "ALREADY_REGISTERED"),
    );
  }

  const sponsorState = await atStage("CHECK_SPONSOR", () => query<{ active: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM users WHERE lower(wallet_address)=lower($1) AND status='ACTIVE'
     ) active`,
    [sponsor],
  ));
  if (!sponsorState.rows[0]?.active) {
    throw new RegistrationStageFailure(
      "CHECK_SPONSOR",
      new ApiError(422, "Sponsor wallet is not active", "SPONSOR_NOT_ACTIVE"),
    );
  }

  await atStage("CHECK_HISTORY_MIGRATION", requireRegistrationSchemaReady);

  const config = getServerConfig();
  const provider = getProvider();
  const network = await atStage("CHECK_RPC", () => provider.getNetwork());
  if (Number(network.chainId) !== CHAIN_ID || CHAIN_ID !== 97) {
    throw new RegistrationStageFailure(
      "CHECK_RPC",
      new ApiError(422, "Registration network is not BNB Testnet", "WRONG_CHAIN"),
    );
  }
  const [contractCode, tokenCode] = await atStage("CHECK_CONTRACTS", () => Promise.all([
    provider.getCode(config.SMART_EARNING_CONTRACT_ADDRESS),
    provider.getCode(config.BSC_TESTNET_USDT_ADDRESS),
  ]));
  if (contractCode === "0x" || tokenCode === "0x") {
    throw new RegistrationStageFailure(
      "CHECK_CONTRACTS",
      new ApiError(503, "Registration contracts are not configured", "CONTRACT_NOT_CONFIGURED"),
    );
  }
  return { registrant, sponsor };
}

export function safeRegistrationError(
  error: unknown,
  fallbackCode = "REGISTRATION_PREPARATION_FAILED",
) {
  const original = error instanceof RegistrationStageFailure ? error.original : error;
  if (original instanceof ApiError) return original;
  if (original instanceof ZodError) {
    return new ApiError(400, "Registration request is invalid", "INVALID_REGISTRATION_REQUEST");
  }
  if (original instanceof ServerConfigError) {
    return new ApiError(503, "Registration service is not configured", "CONTRACT_NOT_CONFIGURED");
  }
  if (original instanceof DatabaseConnectionError) {
    if (original.databaseCode === "PERMISSION_DENIED") {
      return new ApiError(503, "Database permission denied", "DATABASE_PERMISSION_DENIED");
    }
    if (original.databaseCode === "SCHEMA_INCOMPATIBLE") {
      return new ApiError(503, "Database schema is incompatible", "DATABASE_SCHEMA_INCOMPATIBLE");
    }
    return new ApiError(503, "Registration database is unavailable", "DATABASE_UNAVAILABLE");
  }
  if (error instanceof RegistrationStageFailure) {
    if (error.stage === "CHECK_RPC") {
      return new ApiError(503, "Registration RPC is unavailable", "RPC_UNAVAILABLE");
    }
    if (error.stage === "CHECK_CONTRACTS") {
      return new ApiError(503, "Registration contracts are not configured", "CONTRACT_NOT_CONFIGURED");
    }
    if (error.stage === "ENSURE_PLACEMENT") {
      return new ApiError(
        503,
        "Registration placement is temporarily unavailable",
        "REGISTRATION_PLACEMENT_UNAVAILABLE",
      );
    }
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
  original?: unknown;
  registrant?: string;
  sponsor?: string;
  endpoint: string;
}) {
  const suffix = (wallet?: string) => wallet && /^0x[a-fA-F0-9]{40}$/.test(wallet)
    ? `…${wallet.slice(-6).toLowerCase()}` : "unknown";
  const raw = input.original instanceof RegistrationStageFailure
    ? input.original.original : input.original;
  const candidate = raw as {
    name?: string; message?: string; code?: string; constraint?: string;
    table?: string; routine?: string; stack?: string;
  };
  const stackLocation = candidate?.stack?.split("\n").slice(1, 2)[0]?.trim().slice(0, 240);
  console.error("[registration]", {
    stage: input.stage,
    code: input.error.code,
    errorName: candidate?.name || (raw === undefined ? input.error.name : typeof raw),
    message: input.error.message,
    postgresCode: candidate?.code,
    constraint: candidate?.constraint,
    table: candidate?.table,
    routine: candidate?.routine,
    stackLocation,
    registrant: suffix(input.registrant),
    sponsor: suffix(input.sponsor),
    endpoint: input.endpoint,
  });
}
