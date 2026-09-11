"use client";
import { useCallback, useEffect, useState } from "react";
import type { PortalJob } from "@/lib/conferencePortal";
type VisibleJob = Omit<PortalJob, "url" | "owner">;
const button = { padding: "10px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--accent)", color: "#fff", fontWeight: 600, cursor: "pointer" } as const;
export default function ConferenceInbox({ universe }: { universe: string }) {
  const [url, setUrl] = useState(""); const [jobs, setJobs] = useState<VisibleJob[]>([]);
  const [online, setOnline] = useState(false); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false); const [notice, setNotice] = useState(""); const [tickers, setTickers] = useState<Record<string,string>>({});
  const [locked, setLocked] = useState(false); const [code, setCode] = useState("");
  const refresh = useCallback(async () => {
    try { const res = await fetch("/api/conferences", { cache: "no-store" }); const data = await res.json(); if (res.status === 401) { setLocked(true); return; } if (!res.ok) throw Error(data.error); setLocked(false); setJobs(data.jobs); setOnline(data.workerOnline); setLoaded(true); setError(""); }
    catch (e) { setError((e as Error).message || "Unable to load conferences."); }
  }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 15000); return () => clearInterval(timer); }, [refresh]);
  async function submit(body: object) {
    setBusy(true); setError(""); setNotice("");
    try { const res = await fetch("/api/conferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const data = await res.json(); if (!res.ok) throw Error(data.error); setUrl(""); setNotice("Saved. The worker will pick this up automatically."); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <main style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 20px 80px" }}>
    <h1 style={{ fontSize: 28, fontWeight: 750, marginBottom: 8 }}>Conferences</h1>
    <p style={{ color: "var(--text-2)", lineHeight: 1.6, maxWidth: 760 }}>Paste a conference agenda link. Tape captures available presentations, transcribes them on the worker, writes shareholder summaries and adds them to the matching company pages.</p>
    {locked && <form onSubmit={e => { e.preventDefault(); void submit({ action: "unlock", code }); setCode(""); }} style={{ margin: "20px 0", padding: 16, border: "1px solid var(--border)", borderRadius: 10 }}>
      <label htmlFor="conference-code" style={{ display: "block", marginBottom: 10 }}>Conference access code</label>
      <input id="conference-code" type="password" autoComplete="current-password" value={code} onChange={e => setCode(e.target.value)} style={{ padding: 10, marginRight: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", borderRadius: 8 }} />
      <button disabled={busy || !code} style={button}>Unlock conferences</button>
      <p style={{ marginTop: 10, fontSize: 13, color: "var(--text-3)" }}>Private submissions. This browser stays unlocked for 30 days.</p>
    </form>}
    <form onSubmit={e => { e.preventDefault(); void submit({ url }); }} style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "24px 0 10px" }}>
      <label htmlFor="conference-url" style={{ width: "100%", fontWeight: 650 }}>Conference link</label>
      <input id="conference-url" type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://event.webcasts.com/viewer/agenda.jsp?..." style={{ flex: "1 1 420px", minWidth: 0, padding: 12, border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", color: "var(--text)" }} />
      <button style={button} disabled={busy || !url || locked}>{busy ? "Saving…" : "Process conference"}</button>
    </form>
    <p style={{ fontSize: 13, color: "var(--text-3)", lineHeight: 1.6 }}>Supports Webcasts.com conference agendas. A new event may require a one-time sign-in in Chrome on the worker. You can close this page after submitting.</p>
    {error && <p role="alert" style={{ color: "var(--red, #d34e4e)" }}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loaded && <p style={{ margin: "24px 0", color: "var(--text-2)" }}>{online ? "● Conference worker connected" : "○ Conference worker offline — submissions stay queued until it reconnects"}</p>}
    {loaded && !jobs.length && <p>No conferences yet. Add your first link above.</p>}
    {jobs.map(job => <section key={job.id} style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 20, margin: "20px 0", background: "var(--surface-2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div><h2 style={{ fontSize: 19, fontWeight: 700 }}>{job.title}</h2><p style={{ marginTop: 6, color: "var(--text-2)" }}>{job.state === "attention" ? "Needs attention" : job.state === "complete" ? "Published" : job.phase}</p></div>
        {job.state === "attention" && <button style={button} disabled={busy} onClick={() => void submit({ id: job.id, action: "retry" })}>Resume saved work</button>}
      </div>
      {job.message && <p style={{ margin: "12px 0", lineHeight: 1.5 }}>{job.message}</p>}
      {!!job.talks.length && <p style={{ margin: "16px 0", color: "var(--text-3)" }}>{job.talks.filter(t => t.audio).length}/{job.talks.length} recordings · {job.talks.filter(t => t.transcript).length} transcripts · {job.talks.filter(t => t.summary).length} summaries · {job.talks.filter(t => t.published).length} published</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {job.talks.map(t => <li key={t.id} style={{ padding: "12px 0", borderTop: "1px solid var(--border)", lineHeight: 1.6 }}>
          <strong>{t.name}</strong><span style={{ marginLeft: 12, color: "var(--text-3)", fontSize: 13 }}>{t.published ? "Published" : t.summary ? "Summary ready" : t.transcript ? "Transcribed" : t.audio ? "Audio captured" : "Waiting for recording"}</span>
          {t.published && t.symbol && <a style={{ display: "block", color: "var(--accent)" }} href={`/u/${universe}/stock/${encodeURIComponent(t.symbol)}/transcripts?q=conference-${job.id}-${t.id}`}>Read {t.symbol} presentation →</a>}
          {t.error && !t.published && <p style={{ fontSize: 13, color: "var(--text-3)" }}>{t.error}</p>}
          {t.summary && !t.published && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <input aria-label={`Ticker for ${t.name}`} value={tickers[t.id] || ""} placeholder="Match ticker, e.g. FRPT" onChange={e => setTickers({ ...tickers, [t.id]: e.target.value })} style={{ padding: 8, border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", color: "var(--text)" }} />
            <button style={button} disabled={busy || !tickers[t.id]} onClick={() => void submit({ id: job.id, action: "map", talkId: t.id, symbol: tickers[t.id] })}>Match company</button>
          </div>}
        </li>)}
      </ul>
    </section>)}
  </main>;
}

