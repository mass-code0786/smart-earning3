import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MatrixHistoryMenu } from "@/components/matrix-history-menu";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const item = (id: string, module: string) => ({
  id, memberId: "40000000-0000-0000-0000-000000000001",
  wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", module,
  level: 2, position: 4, levelPosition: 2, childSlot: 1, packageId: 3,
  amount: "32000000", transactionHash: `0x${"ab".repeat(32)}`,
  reference: "50000000-0000-0000-0000-000000000001", placedAt: "2026-08-03T10:00:00.000Z",
});

describe("matrix history menu", () => {
  it.each([
    ["MAGIC_LEVEL", {}, "Magic Level Matrix", "module=MAGIC_LEVEL&limit=20"],
    ["X3", { packageId: 3 }, "Package 3 X3 Matrix", "module=X3&limit=20&packageId=3"],
    ["X4", { packageId: 3 }, "Package 3 X4 Matrix", "module=X4&limit=20&packageId=3"],
    ["BOOSTER", { entryId: "30000000-0000-0000-0000-000000000001" }, "Booster entry #1", "module=BOOSTER&limit=20&entryId=30000000-0000-0000-0000-000000000001"],
    ["AUTOPOOL", { entryId: "30000000-0000-0000-0000-000000000001" }, "Global Autopool Matrix", "module=AUTOPOOL&limit=20&entryId=30000000-0000-0000-0000-000000000001"],
  ] as const)("opens only %s placement history", async (module, identifiers, title, query) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [item("10000000-0000-0000-0000-000000000001", module)], nextCursor: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    render(<div className="matrix-history-host"><MatrixHistoryMenu module={module} {...identifiers} title={title}/></div>);
    fireEvent.click(screen.getByRole("button", { name: `Open ${title} history` }));
    expect(await screen.findByRole("dialog", { name: `${title} history` })).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(`/api/matrix/history?${query}`, { cache: "no-store", credentials: "same-origin" });
    expect(screen.getByText("0xabcd…abcd")).toBeInTheDocument();
    expect(screen.getByText("40000000-0000-0000-0000-000000000001")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("shows an empty state and incrementally appends cursor pages", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [item("10000000-0000-0000-0000-000000000001", "X4")], nextCursor: "next-page" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [item("10000000-0000-0000-0000-000000000002", "X4")], nextCursor: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<div className="matrix-history-host"><MatrixHistoryMenu module="X4" packageId={3} title="Package 3 X4 Matrix"/></div>);
    fireEvent.click(screen.getByRole("button", { name: "Open Package 3 X4 Matrix history" }));
    expect(await screen.findByText("No matrix history yet")).toBeInTheDocument();
    view.unmount();

    render(<div className="matrix-history-host"><MatrixHistoryMenu module="X4" packageId={3} title="Package 3 X4 Matrix"/></div>);
    fireEvent.click(screen.getByRole("button", { name: "Open Package 3 X4 Matrix history" }));
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith(
      "/api/matrix/history?module=X4&limit=20&packageId=3&cursor=next-page",
      { cache: "no-store", credentials: "same-origin" },
    ));
    expect(screen.getAllByText("0xabcd…abcd")).toHaveLength(2);
  });
});
