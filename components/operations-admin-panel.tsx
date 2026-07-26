"use client";

import { useCallback, useEffect, useState } from "react";
import { formatTokenUnits } from "@/lib/client/money";

type Overview = {
  system: Record<string, unknown>;
  modules: any[];
  workers: any[];
  alerts: any[];
  queues: Record<string, string>;
  totals: Record<string, string>;
  reconciliation: any[];
  retries: any[];
  audit: any[];
};
const financialKeys = new Set(["magic_amount", "gross_credited", "magic_contribution", "income_credited", "income_available", "income_reserved", "withdrawal_fees", "confirmed_payouts", "dividend_credited", "dividend_remaining_cap", "capped_excess"]);

export function OperationsAdminPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/operations/overview", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error("Operations data is unavailable");
    setData(await response.json());
    setError("");
  }, []);
  useEffect(() => { void load().catch(reason => setError(String(reason))); }, [load]);

  async function write(path: string, body: Record<string, unknown>) {
    setBusy(path);
    try {
      const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Operation failed");
      await load();
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Operation failed");
      return null;
    } finally {
      setBusy("");
    }
  }
  async function toggle(module: string, paused: boolean) {
    const reason = window.prompt(`Reason to ${paused ? "resume" : "pause"} ${module}`)?.trim();
    if (!reason) return;
    const phrase = `${paused ? "RESUME" : "PAUSE"}_${module.replace("_WORKER", "")}`;
    if (window.prompt(`Type ${phrase}`) !== phrase) return;
    await write(`/api/admin/operations/modules/${module}/${paused ? "resume" : "pause"}`, { reason, confirmationPhrase: phrase, idempotencyKey: crypto.randomUUID() });
  }
  async function alertAction(id: string, action: "acknowledge" | "resolve") {
    const reason = window.prompt(action === "resolve" ? "Resolution note (required)" : "Acknowledgment reason (required)")?.trim();
    if (!reason) return;
    await write(`/api/admin/operations/alerts/${id}/${action}`, { reason, idempotencyKey: crypto.randomUUID() });
  }
  async function reconcile() {
    const reason = window.prompt("Reason for this read-only reconciliation run")?.trim();
    if (reason) await write("/api/admin/operations/reconciliation/run", { reason });
  }
  async function retry(type: "magic-funding" | "withdrawal", dryRun: boolean) {
    const raw = window.prompt("Eligible record UUIDs, separated by commas")?.trim();
    const reason = window.prompt("Retry reason (required)")?.trim();
    if (!raw || !reason) return;
    const phrase = type === "magic-funding" ? "RETRY_FAILED_MAGIC_FUNDING" : "RETRY_FAILED_WITHDRAWALS";
    if (window.prompt(`Type ${phrase}`) !== phrase) return;
    const result = await write(`/api/admin/operations/retries/${type}`, { targetIds: raw.split(",").map(value => value.trim()).filter(Boolean), reason, confirmationPhrase: phrase, dryRun });
    if (dryRun && result) window.alert(`Candidates: ${result.candidateCount}; amount: ${formatTokenUnits(String(result.candidateAmount))}; excluded: ${result.excludedCount}`);
  }

  if (!data) return <section className="glass-card mt-6 p-5"><h2 className="font-bold">Production Operations</h2><p className={error ? "text-red-300" : ""}>{error || "Loading operations…"}</p></section>;
  return <section className="glass-card mt-6 min-w-0 p-5">
    <div className="flex items-center justify-between"><div><p className="info-eyebrow">PRODUCTION SAFETY</p><h2 className="text-xl font-bold">Operations Control</h2></div><button className="btn-secondary" disabled={Boolean(busy)} onClick={() => void load()}>Refresh</button></div>
    {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
    <div className="mt-4 grid gap-3 md:grid-cols-4">{Object.entries(data.system).map(([key, value]) => <Card key={key} label={key} value={String(value)} />)}</div>
    <h3 className="mt-6 font-semibold">Module controls</h3>
    <div className="mt-2 grid gap-2 md:grid-cols-2">{data.modules.map(module => <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-white/10 p-3" key={module.module_name}><div className="min-w-0"><p className="break-words font-medium">{module.module_name}</p><p className="text-xs opacity-60">{module.is_paused ? `Paused: ${module.pause_reason}` : "Running"}</p></div><button disabled={Boolean(busy)} className="btn-secondary" onClick={() => void toggle(module.module_name, module.is_paused)}>{module.is_paused ? "Resume" : "Pause"}</button></div>)}</div>
    <h3 className="mt-6 font-semibold">Worker health</h3>
    <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead><tr><th>Worker / instance</th><th>Status</th><th>Heartbeat</th><th>Success / failure</th><th>Processed / failed</th></tr></thead><tbody>{data.workers.map(worker => <tr key={`${worker.worker_name}:${worker.instance_id}`}><td>{worker.worker_name}<small className="block opacity-60">{worker.instance_id}</small></td><td>{worker.current_status}{worker.stale ? " · stale" : ""}</td><td>{new Date(worker.last_heartbeat_at).toLocaleString()}</td><td>{worker.last_success_at ? new Date(worker.last_success_at).toLocaleString() : "—"}<small className="block opacity-60">{worker.last_failure_at ? new Date(worker.last_failure_at).toLocaleString() : "No failure"}</small></td><td>{worker.processed_count} / {worker.failed_count}</td></tr>)}</tbody></table></div>
    <h3 className="mt-6 font-semibold">Queues and financial totals</h3>
    <div className="mt-2 grid gap-3 md:grid-cols-3">{[...Object.entries(data.queues), ...Object.entries(data.totals)].map(([key, value]) => <Card key={key} label={key} value={financialKeys.has(key) ? formatTokenUnits(value) : value} />)}</div>
    <div className="mt-6 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Read-only reconciliation</h3><button className="btn-secondary" disabled={Boolean(busy)} onClick={() => void reconcile()}>Run reconciliation</button></div>
    <div className="mt-2 space-y-2">{data.reconciliation.slice(0, 20).map(run => <div className="rounded-xl border border-white/10 p-3 text-sm" key={run.id}><b>{run.reconciliation_type} · {run.status}</b><p className="text-xs opacity-60">{new Date(run.started_at).toLocaleString()} · matched {run.matched_count} · mismatched {run.mismatched_count} · DB missing {run.missing_database_count} · chain missing {run.missing_chain_count}</p></div>)}{!data.reconciliation.length && <p className="text-sm opacity-60">No reconciliation runs.</p>}</div>
    <h3 className="mt-6 font-semibold">Safe retries</h3>
    <div className="mt-2 flex flex-wrap gap-2"><button className="btn-secondary" onClick={() => void retry("magic-funding", true)}>Preview Magic retry</button><button className="btn-secondary" onClick={() => void retry("withdrawal", true)}>Preview withdrawal retry</button><button className="btn-secondary" onClick={() => void retry("magic-funding", false)}>Request Magic retry</button><button className="btn-secondary" onClick={() => void retry("withdrawal", false)}>Request withdrawal retry</button></div>
    <div className="mt-2 space-y-2">{data.retries.slice(0, 20).map(item => <div className="rounded-xl border border-white/10 p-3 text-xs" key={item.id}>{item.retry_type} · {item.target_id} · {item.status} · {item.request_reason}</div>)}</div>
    <h3 className="mt-6 font-semibold">Alerts</h3>
    <div className="space-y-2">{data.alerts.slice(0, 20).map(alert => <div className="rounded-xl border border-white/10 p-3" key={alert.id}><p className="font-semibold">{alert.severity} · {alert.title}</p><p className="text-sm opacity-70">{alert.description}</p><p className="mt-1 break-all text-xs opacity-60">{alert.alert_type} · {alert.source_reference} · {alert.status}</p>{alert.status !== "RESOLVED" && <div className="mt-2 flex gap-2">{alert.status === "OPEN" && <button className="btn-secondary" onClick={() => void alertAction(alert.id, "acknowledge")}>Acknowledge</button>}<button className="btn-secondary" onClick={() => void alertAction(alert.id, "resolve")}>Resolve</button></div>}</div>)}{!data.alerts.length && <p className="text-sm opacity-60">No alerts.</p>}</div>
    <h3 className="mt-6 font-semibold">Immutable admin audit</h3>
    <div className="space-y-2">{data.audit.slice(0, 20).map(action => <div className="rounded-xl border border-white/10 p-3 text-sm" key={action.id}>{action.admin_wallet} · {action.action_type} · {action.module_name || action.target_type}<small className="block opacity-60">{action.reason} · {new Date(action.created_at).toLocaleString()}</small></div>)}</div>
  </section>;
}

function Card({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-xl border border-white/10 p-3"><p className="break-words text-xs opacity-60">{label.replaceAll("_", " ")}</p><p className="break-all font-semibold">{value}</p></div>;
}
