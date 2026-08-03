import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Page from "@/app/packages/page";

vi.mock("@/components/package-page", () => ({ PackagePage: () => <div>Package purchase UI</div> }));
vi.mock("@/components/ui", () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  GlassCard: ({ children, className }: { children: React.ReactNode; className?: string }) => <section className={className}>{children}</section>,
  StatusBadge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/packages",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

describe("Smart Packages page header", () => {
  it("renders a compact title without the network badge or description", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { name: "Smart Packages" })).toBeInTheDocument();
    expect(screen.queryByText("BNB Testnet")).not.toBeInTheDocument();
    expect(screen.queryByText(/Eight serial USDT packages/)).not.toBeInTheDocument();
    expect(screen.getByText("Package purchase UI")).toBeInTheDocument();
  });
});
