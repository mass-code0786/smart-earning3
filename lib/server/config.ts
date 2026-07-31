import { z } from "zod";

const optionalNonEmpty = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().min(1).optional(),
);

const authSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_SSL_MODE: z.enum(["disable", "require", "verify-full"]).optional(),
  DATABASE_SSL_CA: optionalNonEmpty,
  SESSION_SECRET: z.string().min(32),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
});

const serverSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_SSL_MODE: z.enum(["disable", "require", "verify-full"]).optional(),
  DATABASE_SSL_CA: optionalNonEmpty,
  SESSION_SECRET: z.string().min(32),
  BSC_TESTNET_RPC_URL: z.string().url(),
  SMART_EARNING_CHAIN_ID: z.coerce.number().int().positive().default(97),
  SMART_EARNING_CONTRACT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  BSC_TESTNET_USDT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  KEEPER_PRIVATE_KEY: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  ),
  KEEPER_SECRET: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().min(32).optional(),
  ),
  CONFIRMATIONS_REQUIRED: z.coerce.number().int().min(1).max(50).default(3),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
});

export type ServerConfig = z.infer<typeof serverSchema>;
export type AuthConfig = z.infer<typeof authSchema>;

let cached: ServerConfig | undefined;
let cachedAuth: AuthConfig | undefined;

export class ServerConfigError extends Error {
  constructor(public readonly missingOrInvalid: string[], public readonly scope: string) {
    super(`Invalid ${scope} configuration: ${missingOrInvalid.join(", ")}`);
    this.name = "ServerConfigError";
  }
}

function parseConfig<T>(schema: z.ZodType<T>, scope: string): T {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new ServerConfigError(
      [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] || "environment")))],
      scope,
    );
  }
  return parsed.data;
}

export function getAuthConfig(): AuthConfig {
  if (!cachedAuth) cachedAuth = parseConfig(authSchema, "wallet authentication");
  return cachedAuth;
}

export function getServerConfig(): ServerConfig {
  if (!cached) cached = parseConfig(serverSchema, "blockchain service");
  return cached;
}

export const CHAIN_ID = Number(process.env.SMART_EARNING_CHAIN_ID||97);

export function validateAuthEnvironment() {
  return parseConfig(authSchema, "wallet authentication");
}

const registrationKeys = [
  "BSC_TESTNET_RPC_URL",
  "BSC_TESTNET_USDT_ADDRESS",
  "SMART_EARNING_CONTRACT_ADDRESS",
  "NEXT_PUBLIC_BSC_TESTNET_USDT_ADDRESS",
  "NEXT_PUBLIC_SMART_EARNING_CONTRACT_ADDRESS",
] as const;

export function registrationConfiguration() {
  const address = /^0x[a-fA-F0-9]{40}$/;
  const missing = registrationKeys.filter((key) => {
    const value = process.env[key]?.trim();
    if (!value) return true;
    return key === "BSC_TESTNET_RPC_URL"
      ? !z.string().url().safeParse(value).success
      : !address.test(value);
  });
  return { enabled: missing.length === 0, missing };
}
