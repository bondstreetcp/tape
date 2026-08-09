"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMyNames } from "@/lib/myNames";

// Push alerts setup (P3) — an ntfy topic per user, no accounts: the topic is generated once,
// lives in THIS browser's localStorage, and doubles as the secret (ntfy's model). Enabling
// registers {topic, symbols} server-side so the nightly evaluator can act on client-side state;
// the union re-syncs automatically while enabled. Only three event classes ever notify
// (preannounce / new deal or 13D / reports ≤36h) — everything else stays on the ledger.

const TOPIC_KEY = "myNames.pushTopic";
const ENABLED_KEY = "myNames.pushEnabled";

function getOrMakeTopic(): string {
  try {
    const cur = localStorage.getItem(TOPIC_KEY);
    if (cur) return cur;
    const buf = new Uint8Array(6);
    crypto.getRandomValues(buf);
    const t = "tape-" + [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(TOPIC_KEY, t);
    return t;
  } catch {
    return "";
  }
}

export default function PushAlerts() {
  const { list } = useMyNames();
  const [topic, setTopic] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTopic(getOrMakeTopic());
    try { setEnabled(localStorage.getItem(ENABLED_KEY) === "1"); } catch { /* ignore */ }
  }, []);

  const joined = useMemo(() => [...list].sort().join(","), [list]);

  const sync = async (t: string, syms: string[]): Promise<boolean> => {
    const r = await fetch("/api/push-sub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: t, symbols: syms }) }).catch(() => null);
    return !!r?.ok;
  };

  // Auto re-sync while enabled: the union changed → the server list follows (debounced).
  useEffect(() => {
    if (!enabled || !topic) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { void sync(topic, list); }, 2_000);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, enabled, topic]);

  const toggle = async () => {
    if (!topic) return;
    setBusy(true);
    setStatus(null);
    if (!enabled) {
      const ok = await sync(topic, list);
      if (ok) { setEnabled(true); try { localStorage.setItem(ENABLED_KEY, "1"); } catch { /* */ } setStatus(`Registered ${list.length} names. Subscribe to the topic in the ntfy app to receive alerts.`); }
      else setStatus("Couldn't register — the store may be unreachable. Try again.");
    } else {
      await fetch("/api/push-sub", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic }) }).catch(() => null);
      setEnabled(false);
      try { localStorage.setItem(ENABLED_KEY, "0"); } catch { /* */ }
      setStatus("Unsubscribed — no further alerts for this topic.");
    }
    setBusy(false);
  };

  const test = async () => {
    setBusy(true);
    const r = await fetch("/api/push-sub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic, test: true }) }).catch(() => null);
    setStatus(r?.ok ? "Test sent — it should appear in the ntfy app within seconds." : "Test failed — is the topic subscribed and ntfy reachable?");
    setBusy(false);
  };

  return (
    <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-[var(--text)]">Push alerts <span className="ml-1 rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-3)]">via ntfy</span></h2>
          <p className="mt-0.5 max-w-xl text-[12px] text-[var(--text-3)]">
            Only three things ever notify: a <b>preannouncement</b>, a <b>new deal or 13D</b> on one of your names, and <b>reports within ~36h</b> (with the priced move). Everything else stays on this page.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {enabled && <button onClick={test} disabled={busy} className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-2)] hover:text-[var(--text)] disabled:opacity-50">Send test</button>}
          <button onClick={toggle} disabled={busy || !topic} className={"rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50 " + (enabled ? "bg-[var(--surface-hover)] text-[var(--text-2)]" : "bg-[var(--accent-strong)] text-white")}>
            {enabled ? "Disable" : "Enable push alerts"}
          </button>
        </div>
      </div>
      <div className="mt-2 text-[12px] text-[var(--text-4)]">
        <b className="text-[var(--text-3)]">Setup:</b> install the <a href="https://ntfy.sh/" target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">ntfy app</a> (iOS/Android/desktop), subscribe to the topic{" "}
        <code className="rounded bg-[var(--bg)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-2)]">{topic || "…"}</code>
        <button onClick={() => { try { navigator.clipboard.writeText(topic); setStatus("Topic copied."); } catch { /* */ } }} className="ml-1 text-[var(--accent)] hover:underline">copy</button>
        , then Enable. The topic is random and lives in this browser — treat it like a password (anyone who knows it can read your alerts). Evaluated on the nightly run.
      </div>
      {status && <div className="mt-1.5 text-[12px] text-[var(--text-3)]">{status}</div>}
    </section>
  );
}
