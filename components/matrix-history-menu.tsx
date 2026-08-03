"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, X } from "lucide-react";
import { formatTokenUnits } from "@/lib/client/money";
import { authenticatedWalletFetch } from "@/lib/client/authenticated-fetch";

type Module = "MAGIC_LEVEL" | "X3" | "X4" | "BOOSTER" | "AUTOPOOL";
type Item = {
  id: string; memberId: string; wallet: string; module: Module; level: number | null;
  position: number; levelPosition: number | null; childSlot: number | null;
  packageId: number | null; amount: string | null; transactionHash: string | null;
  reference: string | null; placedAt: string;
};

const moduleNames: Record<Module, string> = {
  MAGIC_LEVEL: "Magic Level Matrix", X3: "X3 Matrix", X4: "X4 Matrix",
  BOOSTER: "Booster Matrix", AUTOPOOL: "Global Autopool",
};
const shortWallet = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

export function MatrixHistoryMenu({ module, packageId, entryId, title }: {
  module: Module; packageId?: number; entryId?: string; title?: string;
}) {
  const [open, setOpen] = useState(false), [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const name = title || moduleNames[module];

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  async function load(append = false) {
    setLoading(true); setError("");
    try {
      const parameters = new URLSearchParams({ module, limit: "20" });
      if (packageId !== undefined) parameters.set("packageId", String(packageId));
      if (entryId) parameters.set("entryId", entryId);
      if (append && cursor) parameters.set("cursor", cursor);
      const response = await authenticatedWalletFetch(`/api/matrix/history?${parameters}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Matrix history unavailable");
      setItems(current => append ? [...current, ...body.items] : body.items);
      setCursor(body.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Matrix history unavailable");
    } finally { setLoading(false); }
  }

  function show() { setOpen(true); setItems([]); setCursor(null); void load(); }

  return <>
    <button type="button" className="matrix-history-menu" aria-label={`Open ${name} history`} onClick={show}><Menu size={15}/></button>
    {open && createPortal(<div className="matrix-history-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="matrix-history-sheet" role="dialog" aria-modal="true" aria-label={`${name} history`}>
        <header><div><small>MATRIX PLACEMENT HISTORY</small><h2>{name}</h2></div><button type="button" aria-label="Close matrix history" onClick={() => setOpen(false)}><X size={18}/></button></header>
        <div className="matrix-history-items">
          {items.map(item => <article key={item.id}>
            <div className="matrix-history-row-head"><span><small>{moduleNames[item.module]}</small><b>{shortWallet(item.wallet)}</b></span><time dateTime={item.placedAt}>{new Date(item.placedAt).toLocaleString()}</time></div>
            <div className="matrix-history-fields">
              <Field label="Member ID" value={item.memberId}/>
              {item.level !== null && <Field label="Level" value={String(item.level)}/>}<Field label="Position / slot" value={String(item.position)}/>
              {item.levelPosition !== null && <Field label="Level position" value={String(item.levelPosition)}/>} {item.childSlot !== null && <Field label="Child slot" value={String(item.childSlot)}/>} 
              {item.packageId !== null && <Field label="Package" value={`#${item.packageId}`}/>} {item.amount !== null && <Field label="Amount" value={`${formatTokenUnits(item.amount)} USDT`}/>} 
              {item.transactionHash && <Field label="Transaction" value={item.transactionHash}/>} {item.reference && <Field label="Reference" value={item.reference}/>} 
            </div>
          </article>)}
          {!loading && !error && !items.length && <div className="matrix-history-empty">No matrix history yet</div>}
          {loading && !items.length && <div className="matrix-history-empty">Loading matrix history…</div>}
          {error && <div className="matrix-history-empty">{error}</div>}
        </div>
        {cursor && <button type="button" className="matrix-history-more" disabled={loading} onClick={() => void load(true)}>{loading ? "Loading…" : "Load more"}</button>}
      </section>
    </div>, document.body)}
  </>;
}

function Field({ label, value }: { label: string; value: string }) {
  return <p><span>{label}</span>{value}</p>;
}
