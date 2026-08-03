import { describe, expect, it, vi } from "vitest";
import { formatBlockchainError, presentBlockchainError } from "@/lib/client/blockchain-error";

describe("safe blockchain error presentation", () => {
  it("maps insufficient intrinsic gas without exposing transaction calldata", () => {
    const calldata = `0x${"ab".repeat(2000)}`;
    const visible = formatBlockchainError({
      code: "INSUFFICIENT_FUNDS",
      message: `insufficient funds for intrinsic transaction cost transaction={ data: ${calldata} }`,
    });
    expect(visible).toBe("Insufficient BNB balance for network gas fee. Please add BNB to your wallet and try again.");
    expect(visible).not.toContain(calldata);
    expect(visible).not.toContain("transaction={");
  });

  it("maps wallet rejection and common transaction failures concisely", () => {
    expect(formatBlockchainError({ code: 4001, message: "User rejected the request" }))
      .toBe("Transaction was rejected in your wallet.");
    expect(formatBlockchainError(new Error("Insufficient USDT balance"))).toContain("Insufficient USDT balance");
    expect(formatBlockchainError(new Error("ERC20InsufficientAllowance"))).toContain("token allowance");
    expect(formatBlockchainError({ code: "CALL_EXCEPTION", message: "execution reverted" })).toContain("Transaction reverted");
    expect(formatBlockchainError({ code: "NETWORK_ERROR", message: "RPC details" })).toContain("temporarily unavailable");
  });

  it("returns a bounded generic message for unknown errors and logs the technical error", () => {
    const error = new Error(`unknown ${"f".repeat(10_000)}`);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const visible = presentBlockchainError("Package purchase failed", error);
    expect(visible).toBe("Transaction could not be completed. Please try again.");
    expect(visible).not.toContain("f".repeat(100));
    expect(consoleError).toHaveBeenCalledWith("Package purchase failed", error);
    consoleError.mockRestore();
  });
});
