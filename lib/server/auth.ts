import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { getAddress, verifyMessage } from "ethers";
import { transaction } from "./db";
import { ApiError } from "./http";
import { getAuthConfig } from "./config";
import { CHAIN_ID } from "./config";

const COOKIE = "se_session";
const encoder = new TextEncoder();

export function sessionCookieOptions(appOrigin: string, nodeEnv = process.env.NODE_ENV) {
  const secureOrigin = new URL(appOrigin).protocol === "https:";
  return {
    httpOnly: true as const,
    // `next start` is commonly used to verify a production build on HTTP
    // localhost. A Secure cookie sent there is silently discarded by browsers.
    secure: secureOrigin,
    sameSite: "strict" as const,
    path: "/",
    maxAge: 12 * 60 * 60,
  };
}

export function normalizeWallet(wallet: string) {
  try {
    return getAddress(wallet).toLowerCase();
  } catch {
    throw new ApiError(400, "Invalid wallet address", "INVALID_WALLET");
  }
}

export function assertSessionWallet(sessionWallet: string, connectedWallet: string | null) {
  if (!connectedWallet) {
    throw new ApiError(401, "Wallet session mismatch", "SESSION_WALLET_MISMATCH");
  }
  try {
    if (normalizeWallet(connectedWallet) !== normalizeWallet(sessionWallet)) {
      throw new ApiError(401, "Wallet session mismatch", "SESSION_WALLET_MISMATCH");
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === "SESSION_WALLET_MISMATCH") throw error;
    throw new ApiError(401, "Wallet session mismatch", "SESSION_WALLET_MISMATCH");
  }
}

export async function createNonce(walletInput: string) {
  getAuthConfig();
  const wallet = normalizeWallet(walletInput);
  const nonce = randomBytes(24).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + 5 * 60_000);
  const message = [
    "Smart Earning Wallet Login",
    `Wallet: ${wallet}`,
    `Chain ID: ${CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expires.toISOString()}`,
    "",
    "Signing is free and does not authorize token transfers.",
  ].join("\n");
  const hash = createHash("sha256").update(nonce).digest("hex");
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO auth_nonces(wallet_address, nonce_hash, message, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [wallet, hash, message, expires],
    );
  });
  return { nonce, message, expiresAt: expires.toISOString() };
}

export async function verifyNonceSignature(input: {
  wallet: string;
  nonce: string;
  signature: string;
}) {
  const wallet = normalizeWallet(input.wallet);
  const hash = createHash("sha256").update(input.nonce).digest("hex");

  await transaction(async (client) => {
    const result = await client.query<{
      id: string;
      message: string;
      expires_at: Date;
      consumed_at: Date | null;
    }>(
      `SELECT id, message, expires_at, consumed_at FROM auth_nonces
       WHERE wallet_address=$1 AND nonce_hash=$2 FOR UPDATE`,
      [wallet, hash],
    );
    const nonce = result.rows[0];
    if (!nonce || nonce.consumed_at || nonce.expires_at <= new Date()) {
      throw new ApiError(401, "Nonce is invalid or expired", "NONCE_INVALID");
    }
    const recovered = normalizeWallet(verifyMessage(nonce.message, input.signature));
    if (recovered !== wallet) {
      throw new ApiError(401, "Signature does not match wallet", "SIGNATURE_INVALID");
    }
    await client.query("UPDATE auth_nonces SET consumed_at=now() WHERE id=$1", [nonce.id]);
  });

  const authConfig = getAuthConfig();
  const token = await new SignJWT({ wallet, chainId: CHAIN_ID })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(wallet)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(encoder.encode(authConfig.SESSION_SECRET));

  const jar = await cookies();
  jar.set(COOKIE, token, sessionCookieOptions(authConfig.APP_ORIGIN));
  return wallet;
}

export async function requireSession() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) throw new ApiError(401, "Wallet login required", "AUTH_REQUIRED");
  try {
    const { payload } = await jwtVerify(
      token,
      encoder.encode(getAuthConfig().SESSION_SECRET),
      { algorithms: ["HS256"] },
    );
    const wallet = normalizeWallet(String(payload.sub));
    assertSessionWallet(wallet, (await headers()).get("x-connected-wallet"));
    return { wallet, chainId: Number(payload.chainId) };
  } catch (error) {
    if (error instanceof ApiError && error.code === "SESSION_WALLET_MISMATCH") throw error;
    throw new ApiError(401, "Session is invalid or expired", "SESSION_INVALID");
  }
}

export async function requireAdmin() {
  const session = await requireSession();
  const result = await transaction((client) =>
    client.query<{ role: string }>("SELECT role FROM users WHERE wallet_address=$1", [session.wallet]),
  );
  if (result.rows[0]?.role !== "ADMIN") {
    throw new ApiError(403, "Administrator access required", "ADMIN_REQUIRED");
  }
  return session;
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}
