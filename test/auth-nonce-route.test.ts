// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createNonce = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/auth", () => ({ createNonce }));

import { POST } from "@/app/api/auth/nonce/route";

const wallet = "0x000000000000000000000000000000000000dEaD";

function request(body: unknown, origin = "http://localhost:3000") {
  return new NextRequest("http://localhost:3000/api/auth/nonce", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/nonce request validation", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://localhost/smart_earning_test";
    process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
    process.env.APP_ORIGIN = "http://localhost:3000";
    createNonce.mockReset();
    createNonce.mockResolvedValue({
      nonce: "a".repeat(48),
      message: [
        "Smart Earning Wallet Login",
        `Wallet: ${wallet.toLowerCase()}`,
        "Chain ID: 97",
      ].join("\n"),
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
  });

  it("accepts a valid BSC Testnet wallet login nonce request", async () => {
    const response = await POST(request({ wallet }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      nonce: "a".repeat(48),
      message: expect.stringContaining("Chain ID: 97"),
    });
    expect(createNonce).toHaveBeenCalledWith(wallet);
  });

  it("rejects a malformed wallet address", async () => {
    const response = await POST(request({ wallet: "0x1234" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "The login request was not accepted",
      code: "VALIDATION_ERROR",
    });
    expect(createNonce).not.toHaveBeenCalled();
  });

  it("rejects a missing wallet field", async () => {
    const response = await POST(request({}));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(createNonce).not.toHaveBeenCalled();
  });

  it("rejects chainId because the strict endpoint contract does not accept it", async () => {
    const response = await POST(request({ wallet, chainId: 1 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(createNonce).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized origin", async () => {
    const response = await POST(request({ wallet }, "https://attacker.example"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Origin is not allowed",
      code: "INVALID_ORIGIN",
    });
    expect(createNonce).not.toHaveBeenCalled();
  });
});
