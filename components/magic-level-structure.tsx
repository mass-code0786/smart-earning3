"use client";

import { Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CenteredModal } from "@/components/centered-modal";
import { MatrixHistoryMenu } from "@/components/matrix-history-menu";
import { authenticatedWalletFetch } from "@/lib/client/authenticated-fetch";

type Level = { level: number; userCount: number };
type User = {
  id: string; wallet: string; position: number; placedAt: string;
};

const emptyLevels = () => Array.from({ length: 20 }, (_, index) => ({ level: index + 1, userCount: 0 }));
const shortWallet = (wallet: string) => `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;

export function MagicLevelStructure() {
  const [levels, setLevels] = useState<Level[]>(emptyLevels), [structureError, setStructureError] = useState("");
  const [selected, setSelected] = useState<number | null>(null), [users, setUsers] = useState<User[]>([]);
  const [cursor, setCursor] = useState<string | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const usersRequest = useRef(0);

  useEffect(() => {
    void authenticatedWalletFetch("/api/matrix/magic-level/structure")
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Magic Level structure unavailable"); setLevels(body.levels); })
      .catch(reason => setStructureError(reason instanceof Error ? reason.message : "Magic Level structure unavailable"));
  }, []);

  async function loadUsers(level: number, append = false) {
    const request = ++usersRequest.current;
    setLoading(true); setError("");
    try {
      const parameters = new URLSearchParams({ level: String(level), limit: "20" });
      if (append && cursor) parameters.set("cursor", cursor);
      const response = await authenticatedWalletFetch(`/api/matrix/magic-level/users?${parameters}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Magic Level users unavailable");
      if (request !== usersRequest.current) return;
      setUsers(current => append ? [...current, ...body.items] : body.items); setCursor(body.nextCursor);
    } catch (reason) { if (request === usersRequest.current) setError(reason instanceof Error ? reason.message : "Magic Level users unavailable"); }
    finally { if (request === usersRequest.current) setLoading(false); }
  }

  function show(level: number) { setSelected(level); setUsers([]); setCursor(null); void loadUsers(level); }

  return <section className="smart-glass-card info-dashboard-card matrix-history-host magic-level-structure">
    <MatrixHistoryMenu module="MAGIC_LEVEL"/>
    <p className="info-eyebrow">MAGIC LEVEL MATRIX</p><h3>Level 1 to Level 20</h3>
    {structureError && <p className="magic-level-structure-error">{structureError}</p>}
    <div className="magic-level-grid">{levels.map(item => <article key={item.level}>
      <div><b>Level {item.level}</b><span>{item.userCount} {item.userCount === 1 ? "User" : "Users"}</span></div>
      <button type="button" onClick={() => show(item.level)}>View More</button>
    </article>)}</div>
    {selected !== null && <CenteredModal open onClose={() => setSelected(null)} eyebrow="MAGIC LEVEL USERS" title={`Level ${selected}`} label={`Magic Level ${selected} users`} closeLabel="Close Magic Level users">
      <div className="magic-level-users">{users.map(user => <article key={user.id}>
        <dl><div><dt>Wallet</dt><dd>{shortWallet(user.wallet)} <button type="button" aria-label={`Copy wallet ${user.wallet}`} onClick={() => void navigator.clipboard?.writeText(user.wallet)}><Copy size={12}/></button></dd></div><div><dt>Position</dt><dd>{user.position}</dd></div><div><dt>Date &amp; Time</dt><dd><time dateTime={user.placedAt}>{new Date(user.placedAt).toLocaleString()}</time></dd></div></dl>
      </article>)}
      {!loading&&!error&&!users.length&&<div className="magic-level-users-empty">No users found in Level {selected}.</div>}
      {loading&&!users.length&&<div className="magic-level-users-empty">Loading Level {selected} users…</div>}
      {error&&<div className="magic-level-users-empty">{error}</div>}
      {cursor&&<button type="button" className="magic-level-users-more" disabled={loading} onClick={() => void loadUsers(selected, true)}>{loading ? "Loading…" : "Load More"}</button>}
      </div>
    </CenteredModal>}
  </section>;
}
