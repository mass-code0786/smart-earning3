import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const purchase = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client/wallet", () => ({
  purchasePackageOnTestnet: purchase,
  walletLogin: vi.fn(),
}));

import { PackagePage } from "@/components/package-page";

const packages = ["PURCHASED", "AVAILABLE", "LOCKED", "LOCKED", "LOCKED", "LOCKED", "LOCKED", "LOCKED"]
  .map((status, index) => ({
    packageId: index + 1,
    name: `Package ${index + 1}`,
    priceTokenUnits: String(2 ** (index + 3) * 1_000_000),
    capAdditionTokenUnits: "40000000",
    magicAllocationTokenUnits: "1000000",
    status,
  }));

const response = () => ({
  wallet: "0x1", registered: true, nextPackage: 2, packages,
  totalPackageValue: "8000000", registrationValue: "2000000", totalEligibleValue: "10000000",
  totalEarningCap: "50000000", totalEarned: "40000000", remainingCap: "10000000", cappingStatus: "ACTIVE",
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); purchase.mockReset(); });

describe("package page serial state", () => {
  it("shows purchased, one available, and remaining locked from backend state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(response()) }));
    render(<PackagePage />);
    await waitFor(() => expect(screen.getByText("5X Earning Cap")).toBeInTheDocument());
    expect(screen.getByText("Buy $16.00 USDT")).toBeEnabled();
    expect(screen.getAllByText("Locked")).toHaveLength(6);
    expect(screen.getAllByText("Purchased").length).toBeGreaterThan(0);
  });

  it("renders a contained safe gas error without raw calldata", async () => {
    const calldata = `0x${"ab".repeat(2000)}`;
    purchase.mockRejectedValueOnce({
      code: "INSUFFICIENT_FUNDS",
      message: `insufficient funds for intrinsic transaction cost transaction={data:${calldata}}`,
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(response()) }));
    render(<PackagePage />);
    fireEvent.click(await screen.findByText("Buy $16.00 USDT"));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Insufficient BNB balance for network gas fee. Please add BNB to your wallet and try again.");
    expect(status).not.toHaveTextContent(calldata);
    expect(status.className).toContain("[overflow-wrap:anywhere]");
    expect(status.className).toContain("[word-break:break-word]");
  });

  it("keeps the successful purchase flow unchanged", async () => {
    purchase.mockImplementationOnce(async (_packageId, _amount, onStatus) => {
      onStatus("Package transaction pending", `0x${"12".repeat(32)}`);
      return { txHash: `0x${"12".repeat(32)}` };
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(response()) }));
    render(<PackagePage />);
    fireEvent.click(await screen.findByText("Buy $16.00 USDT"));
    expect(await screen.findByText("Package 2 confirmed")).toBeInTheDocument();
    expect(purchase).toHaveBeenCalledWith(2, 16_000_000n, expect.any(Function));
  });
});
