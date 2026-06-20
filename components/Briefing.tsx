"use client";
import { useEffect, useState } from "react";

interface Block { headline?: string; text: string }
interface Section { heading: string; kind: "prose" | "list"; blocks?: Block[]; lines?: string[] }
interface Brief { id: string; title: string; edition: string; cadence: string; date: string | null; sections: Section[]; sourceUrl: string; chars: number }
type State = "loading" | "need-auth" | "unconfigured" | "ready" | "error";

export default function Briefing() {
  const [state, setState] = useState<State>("loading");
  const [briefings, setBriefings] = useState<Brief[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const apply = (d: any) => {
    setBriefings(d.briefings || []);
    setFetchedAt(d.fetchedAt || null);
    setState("ready");
  };

  useEffect(() => {
    fetch("/api/briefing")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (d.configured === false) return setState("unconfigured");
        if (r.status === 401 || d.needAuth) return setState("need-auth");
        if (r.ok && d.briefings) return apply(d);
        setState("error");
      })
      .catch(() => setState("error"));
  }, []);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw.trim() || busy) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) { setPw(""); apply(d); }
      else setErr(d.error || "Incorrect password");
    } catch { setErr("Something went wrong"); }
    finally { setBusy(false); }
  };

  if (state === "loading")
    return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-3)]">Loading briefing…</div>;

  if (state === "unconfigured")
    return (
      <Notice title="Briefing not configured">
        Set a <code className="rounded bg-[var(--surface-2)] px-1 py-0.5 text-[var(--text-2)]">BRIEFING_PASSWORD</code> environment variable
        (locally in <code className="rounded bg-[var(--surface-2)] px-1 py-0.5 text-[var(--text-2)]">.env.local</code> and in your Vercel project)
        to enable the private daily briefing.
      </Notice>
    );

  if (state === "error")
    return <Notice title="Couldn’t load the briefing">The source newsletters didn’t come back. They refresh on US-market mornings — try again shortly.</Notice>;

  if (state === "need-auth")
    return (
      <div className="mx-auto max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="mb-3 flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text-3)]"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          <h2 className="text-sm font-semibold text-[var(--text)]">Private daily briefing</h2>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-[var(--text-3)]">
          Reuters Morning News Call &amp; The Day Ahead, parsed each morning. Enter the password to view.
        </p>
        <form onSubmit={unlock} className="space-y-2">
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--border-strong)]"
          />
          {err && <div className="text-xs text-[#ef4444]">{err}</div>}
          <button type="submit" disabled={busy} className="w-full rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-60">
            {busy ? "Checking…" : "Unlock"}
          </button>
        </form>
      </div>
    );

  // ready
  return (
    <div className="space-y-5">
      {fetchedAt && (
        <div className="text-[11px] text-[var(--text-4)]">
          Fetched {new Date(fetchedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · cached a few hours
        </div>
      )}
      {briefings.length === 0 && <Notice title="Nothing parsed">The newsletters returned no readable sections this load.</Notice>}
      {briefings.map((b) => (
        <section key={b.id} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
            <div>
              <h2 className="text-base font-bold text-[var(--text)]">{b.title}</h2>
              <div className="text-[11px] text-[var(--text-4)]">{b.edition}{b.date ? ` · ${b.date}` : ""}</div>
              <div className="mt-1 inline-block rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-3)]">{b.cadence}</div>
            </div>
            <a href={b.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-[#60a5fa] hover:underline">Source PDF ↗</a>
          </header>
          <div className="divide-y divide-[var(--divider)]">
            {b.sections.map((s, i) => (
              <div key={i} className="px-4 py-3">
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#60a5fa]">{s.heading}</h3>
                {s.kind === "list" ? (
                  <div className="space-y-1">
                    {s.lines!.map((l, j) => (
                      <div key={j} className="text-[13px] leading-snug text-[var(--text-2)] tabular-nums">{l}</div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {s.blocks!.map((bl, j) => (
                      <div key={j}>
                        {bl.headline && <div className="text-sm font-semibold leading-snug text-[var(--text)]">{bl.headline}</div>}
                        {bl.text && <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--text-body)]">{bl.text}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="text-[11px] leading-relaxed text-[var(--text-4)]">
        © Reuters / LSEG. Shown for your private research use, parsed from the source PDFs — not redistributed. Headline/paragraph grouping is best-effort from the PDF text.
      </p>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
      <div className="text-sm font-semibold text-[var(--text-2)]">{title}</div>
      <div className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-[var(--text-3)]">{children}</div>
    </div>
  );
}
