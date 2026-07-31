import type {
  IndexerBlock,
  IndexerProvider,
  IndexerReceipt,
} from "@/scripts/indexer-core";

type FetchLike = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;

const wait: Sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function isTransientRpcError(error: unknown) {
  const candidate = error as {
    code?: number | string; status?: number; message?: string;
    cause?: { code?: string };
  };
  const message = `${candidate?.message || ""}`.toLowerCase();
  return candidate?.code === -32005 || candidate?.code === "-32005"
    || candidate?.status === 429
    || ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]
      .includes(candidate?.cause?.code || "")
    || message.includes("429") || message.includes("timeout")
    || message.includes("temporar") || message.includes("connection reset")
    || message.includes("limit exceeded") || message.includes("rate limit")
    || message.includes("too many requests") || message.includes("fetch failed");
}

function hexNumber(value: string | null | undefined) {
  if (!value) throw new Error("RPC response omitted a required block number");
  return Number.parseInt(value, 16);
}

function endpointId(url: string, index: number) {
  try {
    return `rpc-${index + 1}:${new URL(url).hostname}`;
  } catch {
    return `rpc-${index + 1}:invalid`;
  }
}

export class ReadOnlyIndexerRpc implements IndexerProvider {
  private active = 0;
  private requestId = 0;
  private failures = new Map<number, number>();
  private cooldownUntil = new Map<number, number>();
  private failovers = 0;

  constructor(
    private readonly urls: string[],
    private readonly options: {
      fetch?: FetchLike;
      sleep?: Sleep;
      now?: () => number;
      failuresBeforeFailover?: number;
      cooldownMs?: number;
      maxAttempts?: number;
      requestTimeoutMs?: number;
      onRetry?: (details: {
        method: string;
        endpoint: string;
        retryCount: number;
        nextRetryDelayMs: number;
        error: unknown;
      }) => void;
      onSuccess?: (method: string) => void;
    } = {},
  ) {
    if (!urls.length) throw new Error("At least one BSC Testnet RPC URL is required");
  }

  get currentEndpointRedacted() {
    return endpointId(this.urls[this.active], this.active);
  }

  get rpcFailoverCount() {
    return this.failovers;
  }

  private rotate() {
    if (this.urls.length < 2) return;
    const now = (this.options.now ?? Date.now)();
    for (let offset = 1; offset <= this.urls.length; offset += 1) {
      const candidate = (this.active + offset) % this.urls.length;
      if ((this.cooldownUntil.get(candidate) || 0) <= now) {
        if (candidate !== this.active) this.failovers += 1;
        this.active = candidate;
        return;
      }
    }
  }

  async request<T>(method: string, params: unknown[] = []): Promise<T> {
    const maxAttempts = this.options.maxAttempts ?? Math.max(3, this.urls.length * 2);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const endpoint = this.active;
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.options.requestTimeoutMs ?? 12_000,
      );
      try {
        const response = await (this.options.fetch ?? fetch)(this.urls[endpoint], {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: ++this.requestId, method, params,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = Object.assign(new Error(`RPC HTTP ${response.status}`), {
            status: response.status,
          });
          throw error;
        }
        const payload = await response.json() as {
          result?: T; error?: { code: number; message: string };
        };
        if (payload.error) {
          throw Object.assign(new Error(payload.error.message), { code: payload.error.code });
        }
        this.failures.delete(endpoint);
        this.options.onSuccess?.(method);
        return payload.result as T;
      } catch (error) {
        if (!isTransientRpcError(error) || attempt === maxAttempts - 1) throw error;
        const failures = (this.failures.get(endpoint) || 0) + 1;
        this.failures.set(endpoint, failures);
        if (failures >= (this.options.failuresBeforeFailover ?? 2)) {
          this.cooldownUntil.set(
            endpoint,
            (this.options.now ?? Date.now)() + (this.options.cooldownMs ?? 30_000),
          );
          this.rotate();
        }
        const retryDelay = Math.min(500 * 2 ** attempt, 8_000);
        this.options.onRetry?.({
          method,
          endpoint: endpointId(this.urls[endpoint], endpoint),
          retryCount: attempt + 1,
          nextRetryDelayMs: retryDelay,
          error,
        });
        await (this.options.sleep ?? wait)(retryDelay);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error("RPC retry loop exhausted");
  }

  async getChainId() {
    return hexNumber(await this.request<string>("eth_chainId"));
  }

  async getBlockNumber() {
    return hexNumber(await this.request<string>("eth_blockNumber"));
  }

  async getBlockWithTransactions(blockNumber: number): Promise<IndexerBlock> {
    const block = await this.request<{
      number: string;
      transactions: Array<{ hash: string; to: string | null; transactionIndex?: string }>;
    }>("eth_getBlockByNumber", [`0x${blockNumber.toString(16)}`, true]);
    if (!block) throw new Error(`Block ${blockNumber} was not returned by RPC`);
    return {
      number: hexNumber(block.number),
      transactions: block.transactions.map((transaction) => ({
        hash: transaction.hash,
        to: transaction.to,
        transactionIndex: transaction.transactionIndex
          ? hexNumber(transaction.transactionIndex) : undefined,
      })),
    };
  }

  async getTransactionReceipt(transactionHash: string): Promise<IndexerReceipt> {
    const receipt = await this.request<{
      status: string;
      transactionHash: string;
      blockNumber: string;
      logs: Array<{
        address: string; transactionHash: string; blockNumber: string;
        logIndex: string; transactionIndex?: string; topics: string[]; data: string;
      }>;
    }>("eth_getTransactionReceipt", [transactionHash]);
    if (!receipt) throw new Error(`Receipt ${transactionHash} was not returned by RPC`);
    return {
      status: hexNumber(receipt.status),
      transactionHash: receipt.transactionHash,
      blockNumber: hexNumber(receipt.blockNumber),
      logs: receipt.logs.map((log) => ({
        address: log.address,
        transactionHash: log.transactionHash,
        blockNumber: hexNumber(log.blockNumber),
        index: hexNumber(log.logIndex),
        transactionIndex: log.transactionIndex ? hexNumber(log.transactionIndex) : undefined,
        topics: log.topics,
        data: log.data,
      })),
    };
  }
}

export class RateLimitedRpcErrorLogger {
  private fingerprint: string | undefined;
  private lastSummaryAt = 0;

  constructor(
    private readonly output: Pick<Console, "error" | "warn"> = console,
    private readonly now: () => number = Date.now,
  ) {}

  clear(method?: string) {
    if (method && !this.fingerprint?.startsWith(`${method}:`)) return;
    this.fingerprint = undefined;
    this.lastSummaryAt = 0;
  }

  log(input: {
    blockNumber: number | null;
    method: string;
    endpoint: string;
    retryCount: number;
    nextRetryDelayMs: number;
    error: unknown;
  }) {
    const error = input.error as { code?: unknown; message?: unknown };
    const fingerprint = `${input.method}:${error?.code || ""}:${error?.message || String(input.error)}`;
    const now = this.now();
    const summary =
      `block=${input.blockNumber ?? "head"} method=${input.method} endpoint=${input.endpoint}` +
      ` retry=${input.retryCount} next_delay_ms=${input.nextRetryDelayMs}`;
    if (fingerprint !== this.fingerprint) {
      this.fingerprint = fingerprint;
      this.lastSummaryAt = now;
      this.output.error(`[blockchain-indexer] RPC failure ${summary}`, input.error);
    } else if (now - this.lastSummaryAt >= 60_000) {
      this.lastSummaryAt = now;
      this.output.warn(`[blockchain-indexer] RPC still failing ${summary}`);
    }
  }
}

export function indexerRpcUrls(
  primary = process.env.BSC_TESTNET_RPC_URL,
  fallbacks = process.env.BSC_TESTNET_RPC_FALLBACK_URLS,
) {
  if (!primary?.trim()) throw new Error("BSC_TESTNET_RPC_URL is required");
  return [
    primary.trim(),
    ...(fallbacks || "").split(",").map((url) => url.trim()).filter(Boolean),
  ];
}
