// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { Wallet } from "ethers";
import { NextRequest } from "next/server";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
// This integration test constructs localhost requests. Keep its auth origin
// consistent even when the developer's .env points at the deployed HTTPS app.
process.env.APP_ORIGIN = "http://localhost:3000";

const cookieState = vi.hoisted(() => ({
  token: undefined as string | undefined,
  set: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => name === "x-connected-wallet"
      ? "0x5cbdd86a2fa8dc4bddd8a8f69dba48572eec07fb"
      : null,
  }),
  cookies: async () => ({
    get: (name: string) => name === "se_session" && cookieState.token
      ? { name, value: cookieState.token }
      : undefined,
    set: (name: string, value: string, options: unknown) => {
      cookieState.token = value;
      cookieState.set(name, value, options);
    },
    delete: (name: string) => {
      cookieState.token = undefined;
      cookieState.delete(name);
    },
  }),
}));

import { clearSession, createNonce, verifyNonceSignature } from "@/lib/server/auth";
import { getPool } from "@/lib/server/db";
import { GET as getSession } from "@/app/api/auth/session/route";
import { POST as logout } from "@/app/api/auth/logout/route";

const integration = process.env.DATABASE_URL ? describe : describe.skip;
const wallet = new Wallet(`0x${"33".repeat(32)}`);
const attacker = new Wallet(`0x${"44".repeat(32)}`);

integration("real PostgreSQL wallet authentication", () => {
  beforeAll(async () => {
    await getPool().query("DELETE FROM auth_nonces WHERE wallet_address=$1", [
      wallet.address.toLowerCase(),
    ]);
  });

  afterAll(async () => {
    await getPool().query("DELETE FROM auth_nonces WHERE wallet_address=$1", [
      wallet.address.toLowerCase(),
    ]);
    await clearSession();
    await getPool().end();
  });

  it("creates independent expiring nonce rows", async () => {
    const first = await createNonce(wallet.address);
    const second = await createNonce(wallet.address);
    expect(second.nonce).not.toBe(first.nonce);

    const rows = await getPool().query<{
      nonce_hash: string;
      expires_at: Date;
      consumed_at: Date | null;
    }>(
      "SELECT nonce_hash,expires_at,consumed_at FROM auth_nonces WHERE wallet_address=$1 ORDER BY created_at",
      [wallet.address.toLowerCase()],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].nonce_hash).toBe(createHash("sha256").update(first.nonce).digest("hex"));
    expect(rows.rows.every((row) => row.expires_at.getTime() > Date.now())).toBe(true);
    expect(rows.rows.every((row) => row.consumed_at === null)).toBe(true);
  });

  it("rejects an invalid signature without a session, then creates one and rejects replay", async () => {
    const nonce = await createNonce(wallet.address);
    const invalid = await attacker.signMessage(nonce.message);
    await expect(verifyNonceSignature({
      wallet: wallet.address,
      nonce: nonce.nonce,
      signature: invalid,
    })).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    expect(cookieState.token).toBeUndefined();

    const signature = await wallet.signMessage(nonce.message);
    await expect(verifyNonceSignature({
      wallet: wallet.address,
      nonce: nonce.nonce,
      signature,
    })).resolves.toBe(wallet.address.toLowerCase());
    expect(cookieState.set).toHaveBeenCalledWith(
      "se_session",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, secure: false }),
    );

    await expect(verifyNonceSignature({
      wallet: wallet.address,
      nonce: nonce.nonce,
      signature,
    })).rejects.toMatchObject({ code: "NONCE_INVALID" });
  });

  it("returns the authenticated unregistered wallet and deletes the session on logout", async () => {
    const response = await getSession();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      wallet: wallet.address.toLowerCase(),
      chainId: 97,
      registered: false,
    });

    const responseLogout = await logout(new NextRequest("http://localhost:3000/api/auth/logout", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    }));
    expect(responseLogout.status).toBe(200);
    expect(cookieState.delete).toHaveBeenCalledWith("se_session");
    expect(cookieState.token).toBeUndefined();
  });
});
