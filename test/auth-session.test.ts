// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Wallet } from "ethers";

const state = vi.hoisted(() => ({
  row: undefined as undefined | {
    id: string;
    wallet: string;
    hash: string;
    message: string;
    expiresAt: Date;
    consumedAt: Date | null;
  },
  cookieSet: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: state.cookieSet }),
}));

vi.mock("@/lib/server/db", () => ({
  transaction: async (operation: (client: {
    query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
  }) => unknown) => operation({
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes("INSERT INTO auth_nonces")) {
        state.row = {
          id: "nonce-id",
          wallet: String(values[0]),
          hash: String(values[1]),
          message: String(values[2]),
          expiresAt: values[3] as Date,
          consumedAt: null,
        };
        return { rows: [] };
      }
      if (sql.includes("SELECT id, message")) {
        const matches = state.row
          && state.row.wallet === values[0]
          && state.row.hash === values[1];
        return {
          rows: matches ? [{
            id: state.row!.id,
            message: state.row!.message,
            expires_at: state.row!.expiresAt,
            consumed_at: state.row!.consumedAt,
          }] : [],
        };
      }
      if (sql.includes("UPDATE auth_nonces")) {
        if (state.row) state.row.consumedAt = new Date();
        return { rows: [] };
      }
      throw new Error(`Unexpected auth test query: ${sql}`);
    },
  }),
}));

import { createNonce, verifyNonceSignature } from "@/lib/server/auth";

const loginWallet = () => new Wallet(`0x${"11".repeat(32)}`);
const otherWallet = () => new Wallet(`0x${"22".repeat(32)}`);

describe("nonce verification and session creation", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://localhost/smart_earning_test";
    process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
    process.env.APP_ORIGIN = "http://localhost:3000";
    state.row = undefined;
    state.cookieSet.mockReset();
  });

  it("rejects an expired nonce without creating a session", async () => {
    const wallet = loginWallet();
    const nonce = await createNonce(wallet.address);
    state.row!.expiresAt = new Date(Date.now() - 1);

    await expect(verifyNonceSignature({
      wallet: wallet.address,
      nonce: nonce.nonce,
      signature: await wallet.signMessage(nonce.message),
    })).rejects.toMatchObject({ code: "NONCE_INVALID", status: 401 });
    expect(state.cookieSet).not.toHaveBeenCalled();
  });

  it("creates a localhost session once and rejects replay", async () => {
    const wallet = loginWallet();
    const nonce = await createNonce(wallet.address);
    const request = {
      wallet: wallet.address,
      nonce: nonce.nonce,
      signature: await wallet.signMessage(nonce.message),
    };

    await expect(verifyNonceSignature(request)).resolves.toBe(wallet.address.toLowerCase());
    expect(state.cookieSet).toHaveBeenCalledWith(
      "se_session",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, secure: false, path: "/" }),
    );
    await expect(verifyNonceSignature(request)).rejects.toMatchObject({
      code: "NONCE_INVALID",
      status: 401,
    });
    expect(state.cookieSet).toHaveBeenCalledTimes(1);
  });

  it("does not consume the nonce or create a session for another signer", async () => {
    const wallet = loginWallet();
    const attacker = otherWallet();
    const nonce = await createNonce(wallet.address);

    await expect(verifyNonceSignature({
      wallet: wallet.address,
      nonce: nonce.nonce,
      signature: await attacker.signMessage(nonce.message),
    })).rejects.toMatchObject({ code: "SIGNATURE_INVALID", status: 401 });
    expect(state.row!.consumedAt).toBeNull();
    expect(state.cookieSet).not.toHaveBeenCalled();
  });
});
