"use client";
import { useEffect, useState } from "react";

interface Block { headline?: string; text: string }
interface Section { heading: string; kind: "prose" | "list"; blocks?: Block[]; lines?: string[] }
interface Brief { id: string; title: string; edition: string; cadence: string; date: string | null; sections: Section[]; sourceUrl: string; chars: number }
type State = "loading" | "need-auth" | "unconfigured" | "ready" | "error";

// Long market-wrap blocks (e.g. "Key Results") arrive as one giant run-on paragraph. Break them
// at sentence boundaries into ~paragraph-sized chunks so they're readable instead of a wall.
function splitParagraphs(text: string): string[] {
  if (text.length <= 380) return [text];
  const sents = text.split(/(?<=[.!?])\s+(?=[A-Z“"])/);
  const paras: string[] = [];
  let cur = "";
  for (const s of sents) {
    cur = cur ? `${cur} ${s}` : s;
    if (cur.length >= 300) { paras.push(cur); cur = ""; }
  }
  if (cur.trim()) paras.push(cur.trim());
  return paras.length ? paras : [text];
}

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
      <div className="grid items-start gap-5 xl:grid-cols-2">
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
                  isDataTable(s.lines!) ? (
                    <DataSection lines={s.lines!} />
                  ) : (
                    <div className="space-y-1">
                      {s.lines!.map((l, j) => (
                        <div key={j} className="text-[13px] leading-snug text-[var(--text-2)]">{l}</div>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="space-y-3">
                    {s.blocks!.map((bl, j) => (
                      <div key={j} className="space-y-2">
                        {bl.headline && <div className="text-sm font-semibold leading-snug text-[var(--text)]">{bl.headline}</div>}
                        {bl.text && splitParagraphs(bl.text).map((para, k) => (
                          <p key={k} className="text-[13px] leading-relaxed text-[var(--text-body)]">{para}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--text-4)]">
        © Reuters / LSEG. Shown for your private research use, parsed from the source PDFs — not redistributed. Headline/paragraph grouping is best-effort from the PDF text.
      </p>
    </div>
  );
}

// --- Markets / data tables -------------------------------------------------
// "List" sections (the STOCKS/treasuries/FX/commodities snapshot, gainers/losers,
// economic events) arrive as flat PDF text lines that run together. Parse each into a
// row label + its trailing numbers and lay them out in an aligned table — much easier
// to scan than the raw run-on text. Best-effort: anything that doesn't parse as a data
// row just shows as a sub-header line, so it always degrades gracefully.
const NUM_TOK = /^[-+$]?\d[\d,]*\.?\d*(?:\/\d+)?%?$/; // 1,234.5 · -0.37 · 6.84% · -15/32 · $74.82
// A value-column token: a number, or a placeholder for a missing one ("-", "n/a"). Economic-
// events rows ("ADP pulse 0815 - 25,500") use a lone dash for a blank Poll/Prior, which would
// otherwise split the row in the wrong place and glue the ET time onto the label.
const isVal = (t: string) => NUM_TOK.test(t) || /^[-–—]+$/.test(t) || /^n\/?a$/i.test(t);

function tokenize(line: string): string[] {
  const out: string[] = [];
  for (const t of line.split(/\s+/)) {
    // merge a treasury 32nds tick ("-15 /32" → "-15/32") onto the preceding number
    if (t.startsWith("/") && out.length && NUM_TOK.test(out[out.length - 1])) out[out.length - 1] += t;
    else out.push(t);
  }
  return out;
}

type DataRow = { label: string; nums: string[] } | { subheader: string };

function parseDataRows(lines: string[]): DataRow[] {
  const rows: DataRow[] = [];
  let pending: string | null = null; // a label (or sub-header) awaiting its number row
  const flush = () => { if (pending != null) rows.push({ subheader: pending }); pending = null; };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const toks = tokenize(line);
    let numStart = toks.length;
    for (let i = toks.length - 1; i >= 0 && isVal(toks[i]); i--) numStart = i;
    if (numStart === toks.length) { flush(); pending = line; }                                   // no trailing numbers → label/sub-header
    else if (numStart === 0) { rows.push({ label: pending ?? "", nums: toks }); pending = null; } // numbers only → pair with the held label
    else { flush(); rows.push({ label: toks.slice(0, numStart).join(" "), nums: toks.slice(numStart) }); } // label + numbers on one line
  }
  flush();
  return rows;
}

// Only treat a list section as a data table when its lines actually read like one (short
// labels + numbers, e.g. the markets snapshot / gainers / ex-dividends). Bulleted, sentence-y
// sections (Analysts' Recommendation) stay as plain text lines.
function isDataTable(lines: string[]): boolean {
  if (lines.length < 2) return false;
  let tab = 0, bullets = 0;
  for (const raw of lines) {
    const l = raw.trim();
    if (/^[•▪·‣]/.test(l)) { bullets++; continue; }
    const toks = tokenize(l);
    let ns = toks.length;
    for (let i = toks.length - 1; i >= 0 && isVal(toks[i]); i--) ns = i;
    const numCount = toks.length - ns;
    const labelLen = toks.slice(0, ns).join(" ").length;
    if (numCount === toks.length) tab++;               // pure numbers
    else if (numCount >= 1 && labelLen <= 46) tab++;   // label + number(s) (company/index name)
    else if (numCount === 0 && l.length <= 24) tab++;  // short bare label (e.g. an index name)
  }
  // Bulleted/sentence-y sections (Analysts' Recommendation) are guarded by the bullet ratio.
  return bullets <= lines.length * 0.15 && tab >= lines.length * 0.4;
}

function DataSection({ lines }: { lines: string[] }) {
  const rows = parseDataRows(lines);
  // split into sub-tables at each sub-header so columns align within each block
  const blocks: { header?: string; rows: { label: string; nums: string[] }[] }[] = [];
  let cur: { header?: string; rows: { label: string; nums: string[] }[] } = { rows: [] };
  for (const r of rows) {
    if ("subheader" in r) { if (cur.rows.length) blocks.push(cur); cur = { header: r.subheader, rows: [] }; }
    else cur.rows.push(r);
  }
  if (cur.rows.length) blocks.push(cur); // drop dangling header-only blocks (e.g. a mis-ordered column header)

  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) => {
        const cols = b.rows.length ? Math.max(...b.rows.map((r) => r.nums.length)) : 0;
        return (
          <div key={i}>
            {b.header && <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{b.header}</div>}
            {b.rows.length > 0 && (
              <table className="w-full text-[12px]">
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j} className="border-b border-[var(--divider)] last:border-0">
                      <td className="whitespace-nowrap py-1 pr-3 text-[var(--text-2)]">{r.label}</td>
                      {Array.from({ length: cols }, (_, k) => {
                        const n = r.nums[k];
                        return (
                          <td key={k} className="py-1 pl-2 text-right tabular-nums" style={{ color: n && /^-/.test(n) ? "#ef4444" : "var(--text-2)" }}>
                            {n ?? ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
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
