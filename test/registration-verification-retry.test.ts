// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  RegistrationFlowError,
  verifyRegistrationWithRetry,
} from "@/lib/client/wallet";

const txHash = `0x${"1".repeat(64)}`;
const sponsor = "0x0000000000000000000000000000000000000001";
const response = (status: number, body: object) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe("registration confirmation retry", () => {
  it("treats confirmations pending as pending and eventually succeeds", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(409, { code: "CONFIRMATIONS_PENDING" }))
      .mockResolvedValueOnce(response(200, { registrationId: "registration-1" }));
    const result = await verifyRegistrationWithRetry(txHash, sponsor, vi.fn(), {
      attempts: 3, fetcher, sleep: vi.fn(async () => undefined),
    });
    expect(result.pendingSync).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns pending-sync with the preserved hash after timeout", async () => {
    const fetcher = vi.fn(async () => response(409, { code: "CONFIRMATIONS_PENDING" }));
    const result = await verifyRegistrationWithRetry(txHash, sponsor, vi.fn(), {
      attempts: 2, fetcher, sleep: vi.fn(async () => undefined),
    });
    expect(result).toMatchObject({ pendingSync: true, txHash, code: "CONFIRMATIONS_PENDING" });
  });

  it("stops immediately for a permanent validation error", async () => {
    const fetcher = vi.fn(async () => response(422, {
      code: "WRONG_CONTRACT", error: "Wrong contract",
    }));
    await expect(verifyRegistrationWithRetry(txHash, sponsor, vi.fn(), { fetcher }))
      .rejects.toMatchObject({ code: "WRONG_CONTRACT" } satisfies Partial<RegistrationFlowError>);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("allows an idempotent retry using the same transaction hash", async () => {
    const fetcher = vi.fn(async () => response(200, {
      registrationId: "registration-1", duplicate: true,
    }));
    const result = await verifyRegistrationWithRetry(txHash, sponsor, vi.fn(), { fetcher });
    expect(result).toMatchObject({ txHash, duplicate: true, pendingSync: false });
  });
});
