// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  RateLimitedRpcErrorLogger,
  ReadOnlyIndexerRpc,
} from "@/lib/blockchain/indexer-rpc";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

describe("read-only indexer RPC failover", () => {
  it("rotates endpoints after repeated transient failures without exposing URL secrets", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      if (calls.length <= 2) return response({
        jsonrpc: "2.0", id: 1, error: { code: -32005, message: "limit exceeded" },
      });
      return response({ jsonrpc: "2.0", id: 1, result: "0x61" });
    });
    const rpc = new ReadOnlyIndexerRpc([
      "https://primary.example/rpc?key=secret",
      "https://fallback.example/rpc?key=other-secret",
    ], { fetch: fetcher as typeof fetch, sleep: async () => undefined });
    await expect(rpc.getChainId()).resolves.toBe(97);
    expect(calls).toEqual([
      "https://primary.example/rpc?key=secret",
      "https://primary.example/rpc?key=secret",
      "https://fallback.example/rpc?key=other-secret",
    ]);
    expect(rpc.currentEndpointRedacted).toBe("rpc-2:fallback.example");
    expect(rpc.rpcFailoverCount).toBe(1);
  });

  it("rate-limits identical error logs and clears suppression after success", () => {
    let now = 0;
    const output = { error: vi.fn(), warn: vi.fn() };
    const logger = new RateLimitedRpcErrorLogger(output, () => now);
    const input = {
      blockNumber: 123, method: "eth_getBlockByNumber",
      endpoint: "rpc-1:example", retryCount: 1, nextRetryDelayMs: 500,
      error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
    };
    logger.log(input);
    now = 30_000;
    logger.log({ ...input, retryCount: 2 });
    now = 60_000;
    logger.log({ ...input, retryCount: 3 });
    expect(output.error).toHaveBeenCalledOnce();
    expect(output.warn).toHaveBeenCalledOnce();
    logger.clear("eth_blockNumber");
    logger.log(input);
    expect(output.error).toHaveBeenCalledOnce();
    logger.clear("eth_getBlockByNumber");
    logger.log(input);
    expect(output.error).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(output.error.mock.calls)).not.toContain("secret");
  });
});
