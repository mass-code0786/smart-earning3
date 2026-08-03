import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MatrixHistoryMenu } from "@/components/matrix-history-menu";

const walletState = vi.hoisted(() => ({ connectedWallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" }));
vi.mock("@/lib/client/wallet", () => ({
  getInjectedProvider: () => ({ request: vi.fn(async () => [walletState.connectedWallet.toUpperCase().replace("0X", "0x")]) }),
}));

function expectAuthenticatedRequest(fetcher: ReturnType<typeof vi.fn>, url: string) {
  expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({
    cache: "no-store", credentials: "same-origin", headers: expect.any(Headers),
  }));
  const call = fetcher.mock.calls.find(([input]) => input === url);
  expect(new Headers(call?.[1]?.headers).get("x-connected-wallet")).toBe(walletState.connectedWallet);
}

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
    expectAuthenticatedRequest(fetcher, `/api/matrix/history?${query}`);
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
    await waitFor(() => expectAuthenticatedRequest(fetcher,
      "/api/matrix/history?module=X4&limit=20&packageId=3&cursor=next-page"));
    expect(screen.getAllByText("0xabcd…abcd")).toHaveLength(2);
  });

  it("portals a centered, internally scrolling modal above app navigation", async () => {
    const items = Array.from({ length: 25 }, (_, index) => item(`10000000-0000-0000-0000-${String(index).padStart(12, "0")}`, "X3"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items, nextCursor: null }), { status: 200 })));
    render(<div className="matrix-history-host"><MatrixHistoryMenu module="X3" packageId={1} title="Package 1 X3 Matrix"/></div>);
    fireEvent.click(screen.getByRole("button", { name: "Open Package 1 X3 Matrix history" }));
    const dialog = await screen.findByRole("dialog", { name: "Package 1 X3 Matrix history" });
    const backdrop = dialog.parentElement!;
    expect(backdrop.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByText("MATRIX PLACEMENT HISTORY")).toBeInTheDocument();
    expect(dialog.querySelector(".matrix-history-items")).toBeInTheDocument();

    const css = readFileSync(resolve("app/dashboard.css"), "utf8");
    expect(backdrop).toHaveClass("centered-modal-backdrop");
    expect(dialog).toHaveClass("centered-modal-panel");
    expect(dialog.querySelector(".centered-modal-scroll")).toBeInTheDocument();
    expect(css).toMatch(/\.centered-modal-backdrop\{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center/);
    expect(css).toContain("width:min(580px,calc(100% - 32px))");
    expect(css).toContain("max-height:min(80dvh,calc(100dvh");
    expect(css).toContain(".centered-modal-scroll{min-height:0;overflow-y:auto");
    expect(css).not.toContain(".matrix-history-backdrop");
    expect(css).not.toContain(".income-history-backdrop");

    fireEvent.click(screen.getByRole("button", { name: "Close matrix history" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });

  it("closes from the backdrop and Escape key", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    render(<div className="matrix-history-host"><MatrixHistoryMenu module="MAGIC_LEVEL"/></div>);
    const open = () => fireEvent.click(screen.getByRole("button", { name: "Open Magic Level Matrix history" }));
    open();
    let dialog = await screen.findByRole("dialog");
    fireEvent.mouseDown(dialog.parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    open();
    dialog = await screen.findByRole("dialog");
    expect(fetcher).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog).not.toBeInTheDocument();
  });
});
