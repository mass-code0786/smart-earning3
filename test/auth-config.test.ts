import { afterEach, describe, expect, it } from "vitest";
import { sessionCookieOptions } from "@/lib/server/auth";
import { ServerConfigError, validateAuthEnvironment, validateServerEnvironment } from "@/lib/server/config";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("wallet auth environment", () => {
  it("reports the exact missing auth variables", () => {
    delete process.env.DATABASE_URL;
    delete process.env.SESSION_SECRET;
    process.env.APP_ORIGIN = "http://localhost:3000";
    try {
      validateAuthEnvironment();
      throw new Error("validation should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ServerConfigError);
      expect((error as ServerConfigError).missingOrInvalid).toEqual(
        expect.arrayContaining(["DATABASE_URL", "SESSION_SECRET"]),
      );
    }
  });

  it("normalizes CRLF and surrounding whitespace for auth configuration", () => {
    process.env.DATABASE_URL = "  postgresql://app:secret@db/live\r\n";
    process.env.DATABASE_SSL_MODE = "disable\r";
    process.env.SESSION_SECRET = `  ${"s".repeat(40)}\r`;
    process.env.APP_ORIGIN = " https://smartearning.io\r";

    expect(validateAuthEnvironment()).toEqual(expect.objectContaining({
      DATABASE_URL: "postgresql://app:secret@db/live",
      DATABASE_SSL_MODE: "disable",
      SESSION_SECRET: "s".repeat(40),
      APP_ORIGIN: "https://smartearning.io",
    }));
  });

  it("normalizes blockchain and worker scalar configuration", () => {
    Object.assign(process.env, {
      DATABASE_URL: "postgresql://app:secret@db/live\r", DATABASE_SSL_MODE: "require\r",
      SESSION_SECRET: `${"s".repeat(40)}\r`, APP_ORIGIN: "https://smartearning.io\r",
      BSC_TESTNET_RPC_URL: " https://rpc.example.com\r", SMART_EARNING_CHAIN_ID: "97\r",
      SMART_EARNING_CONTRACT_ADDRESS: `0x${"1".repeat(40)}\r`,
      BSC_TESTNET_USDT_ADDRESS: ` 0x${"2".repeat(40)}\n`,
      KEEPER_PRIVATE_KEY: `0x${"3".repeat(64)}\r`, CONFIRMATIONS_REQUIRED: "3\r",
    });
    expect(validateServerEnvironment()).toMatchObject({
      BSC_TESTNET_RPC_URL: "https://rpc.example.com", SMART_EARNING_CHAIN_ID: 97,
      SMART_EARNING_CONTRACT_ADDRESS: `0x${"1".repeat(40)}`,
      BSC_TESTNET_USDT_ADDRESS: `0x${"2".repeat(40)}`,
      KEEPER_PRIVATE_KEY: `0x${"3".repeat(64)}`, CONFIRMATIONS_REQUIRED: 3,
    });
  });

  it("does not mark the localhost development session cookie Secure", () => {
    expect(sessionCookieOptions("http://localhost:3000", "development")).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      path: "/",
    });
  });

  it("keeps production cookies Secure", () => {
    expect(sessionCookieOptions("https://app.example.com", "production").secure).toBe(true);
  });

  it("allows a production build to be verified on HTTP localhost", () => {
    expect(sessionCookieOptions("http://localhost:3000", "production").secure).toBe(false);
  });
});
