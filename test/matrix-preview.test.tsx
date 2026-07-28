import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { X3Page } from "@/components/x3-page";
import { X4Page } from "@/components/x4-page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const prices = [8, 16, 32, 64, 128, 256, 512, 1024];

describe("package-wise matrix previews", () => {
  it("renders all eight X3 package matrices with live cycle, earning and recycle metrics", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ packages: prices.map((price, index) => ({
        packageId: index + 1,
        priceTokenUnits: String(price * 1_000_000),
        x3Allocation: String(price * 250_000),
        active: index === 0,
        permanentSponsor: null,
        matrixParent: null,
        currentCycle: index === 0 ? 2 : 0,
        slots: index === 0 ? [{
          slotNumber: 1,
          wallet: "0x1111111111111111111111111111111111111111",
          placementType: "DIRECT",
        }] : [],
        earnedIncome: index === 0 ? "3000000" : "0",
        heldIncome: "0",
        releasedIncome: "0",
        recycleCount: index === 0 ? 1 : 0,
      })) }),
    }));
    render(<X3Page />);
    await waitFor(() => expect(screen.getAllByText(/Package \d/)).toHaveLength(8));
    expect(screen.getAllByText("Filled positions / total positions")).toHaveLength(8);
    expect(screen.getByText("1 times ♻️")).toBeInTheDocument();
    expect(screen.getByText("$3.00 USDT")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Package \d X3 structure/)).toHaveLength(8);
  });

  it("renders all eight X4 package matrices with live cycle, earning and recycle metrics", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        packages: prices.map((price, index) => ({
          packageId: index + 1,
          priceTokenUnits: String(price * 1_000_000),
          active: index === 0,
          currentCycle: index === 0 ? 3 : 0,
          cycleStatus: index === 0 ? "ACTIVE" : "INACTIVE",
          slots: index === 0 ? [{
            slotNumber: 1,
            level: 1,
            wallet: "0x1111111111111111111111111111111111111111",
            placementType: "GLOBAL",
          }] : [],
          filledPositions: index === 0 ? 1 : 0,
          emptyPositions: index === 0 ? 5 : 6,
          recycleCount: index === 0 ? 2 : 0,
          magicLevelIncome: index === 0 ? "1000000" : "0",
          level2Income: index === 0 ? "2000000" : "0",
          cappedExcess: "0",
          totalEarnings: index === 0 ? "3000000" : "0",
        })),
        history: [],
      }),
    }));
    render(<X4Page />);
    await waitFor(() => expect(screen.getAllByText(/Package \d/)).toHaveLength(8));
    expect(screen.getAllByText("Filled positions / total positions")).toHaveLength(8);
    expect(screen.getByText("2 times ♻️")).toBeInTheDocument();
    expect(screen.getByText("$3.00 USDT")).toBeInTheDocument();
    expect(screen.getAllByText("LOCKED")).toHaveLength(7);
  });
});
