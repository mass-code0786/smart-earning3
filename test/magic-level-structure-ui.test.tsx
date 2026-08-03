import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MagicLevelStructure } from "@/components/magic-level-structure";

const authenticatedWalletFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client/authenticated-fetch", () => ({ authenticatedWalletFetch }));
afterEach(() => { cleanup(); authenticatedWalletFetch.mockReset(); });

const levels = Array.from({ length: 20 }, (_, index) => ({ level: index + 1, userCount: index === 0 ? 2 : 0 }));
const user = {
  id: "10000000-0000-0000-0000-000000000001", memberId: "20000000-0000-0000-0000-000000000001",
  wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", level: 1, position: 0,
  registrationId: "30000000-0000-0000-0000-000000000001", transactionHash: `0x${"ab".repeat(32)}`,
  placedAt: "2026-08-03T10:00:00.000Z",
};

describe("Magic Level structure UI", () => {
  it("always shows all 20 cards and opens only the selected level in the centered modal", async () => {
    authenticatedWalletFetch.mockImplementation(async (url: string) => new Response(JSON.stringify(
      url.endsWith("/structure") ? { levels } : { items: url.includes("level=1") ? [user] : [], nextCursor: null },
    ), { status: 200 }));
    render(<MagicLevelStructure/>);
    expect(await screen.findByText("2 Users")).toBeInTheDocument();
    expect(screen.getByText("Level 20")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "View More" })).toHaveLength(20);

    fireEvent.click(screen.getAllByRole("button", { name: "View More" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Magic Level 1 users" });
    expect(dialog).toHaveClass("centered-modal-panel");
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe("hidden");
    expect(within(dialog).getByRole("heading", { name: "Level 1" })).toBeInTheDocument();
    expect(within(dialog).getByText("0xabcd…abcd")).toBeInTheDocument();
    expect(within(dialog).getByText("0")).toBeInTheDocument();
    expect(within(dialog).getByText("Wallet")).toBeInTheDocument();
    expect(within(dialog).getByText("Position")).toBeInTheDocument();
    expect(within(dialog).getByText("Date & Time")).toBeInTheDocument();
    for (const hidden of ["Member ID", "Level", "Position / slot", "Placement ID", "Registration reference", "Transaction", user.memberId, user.id, user.registrationId, user.transactionHash]) {
      expect(within(dialog).queryByText(hidden!)).not.toBeInTheDocument();
    }
    expect(authenticatedWalletFetch).toHaveBeenCalledWith("/api/matrix/magic-level/users?level=1&limit=20");

    fireEvent.click(screen.getByRole("button", { name: "Close Magic Level users" }));
    fireEvent.click(screen.getAllByRole("button", { name: "View More" })[1]);
    expect(await screen.findByText("No users found in Level 2.")).toBeInTheDocument();
    expect(screen.queryByText(user.memberId)).not.toBeInTheDocument();
    expect(authenticatedWalletFetch).toHaveBeenCalledWith("/api/matrix/magic-level/users?level=2&limit=20");
  });

  it("loads subsequent selected-level pages without replacing existing users", async () => {
    authenticatedWalletFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ levels }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [user], nextCursor: "next" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ ...user, id: "10000000-0000-0000-0000-000000000002", wallet: "0x1234567890abcdef1234567890abcdef12345678", position: 1 }], nextCursor: null }), { status: 200 }));
    render(<MagicLevelStructure/>);
    await screen.findByText("2 Users");
    fireEvent.click(screen.getAllByRole("button", { name: "View More" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Load More" }));
    await waitFor(() => expect(authenticatedWalletFetch).toHaveBeenCalledWith("/api/matrix/magic-level/users?level=1&limit=20&cursor=next"));
    expect(await screen.findByText("0x1234…5678")).toBeInTheDocument();
    expect(screen.getByText("0xabcd…abcd")).toBeInTheDocument();
  });
});
