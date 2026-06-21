"use client";
import { useState } from "react";
import MarkdownLite from "./MarkdownLite";

interface Result { available: boolean; form?: string; date?: string | null; url?: string; summary?: string | null }
type Form = "10-K" | "10-Q";

const SUBTITLE: Record<Form, string> = { "10-K": "annual report", "10-Q": "quarterly report" };

export default function FilingAI({ symbol, name }: { symbol: string; name?: string }) {
  const label = name || symbol;
  const [form, setForm] = useState<Form>("10-K");
  const [byForm, setByForm] = useState<Record<Form, Result | null>>({ "10-K": null, "10-Q": null });
  const [loadingForm, setLoadingForm] = useState<Form | null>(null);
  const [errByForm, setErrByForm] = useState<Record<Form, string | null>>({ "10-K": null, "10-Q": null });

  const data = byForm[form];
  const loading = loadingForm === form;
  const error = errByForm[form];

  const run = (f: Form) => {
    setForm(f);
    if (byForm[f] || loadingForm) return; // cached, or another fetch in flight
    setLoadingForm(f);
    setErrByForm((p) => ({ ...p, [f]: null }));
    fetch(`/api/filing-summary/${encodeURIComponent(symbol)}?form=${f}`)
      .then((r) => r.json())
      .then((d) => {
        const err =
          d.configured === false ? "Add a GEMINI_API_KEY to enable this."
          : !d.available ? `Couldn't find a recent ${f} on file for ${label}.`
          : d.summary ? null
          : d.error || `Couldn't summarize the ${f}.`;
        if (err) setErrByForm((p) => ({ ...p, [f]: err }));
        else setByForm((p) => ({ ...p, [f]: d }));
      })
      .catch(() => setErrByForm((p) => ({ ...p, [f]: "Something went wrong reaching the AI." })))
      .finally(() => setLoadingForm((cur) => (cur === f ? null : cur)));
  };

  return (
    <section className="mb-4 rounded-xl border border-[#a855f7]/40 bg-[#a855f7]/[0.06] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-[var(--text-2)]">
          <span className="text-base">📑</span> AI filing deep-dive
        </span>
        <span className="text-[11px] text-[var(--text-4)]">— reads the full report from SEC EDGAR</span>
        <div className="ml-auto inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5 text-xs font-medium">
          {(["10-K", "10-Q"] as Form[]).map((f) => (
            <button
              key={f}
              onClick={() => run(f)}
              disabled={!!loadingForm}
              className={"rounded-md px-2.5 py-1 transition-colors disabled:opacity-60 " + (form === f ? "bg-[#7c3aed] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {!data && !loading && !error && (
        <button
          onClick={() => run(form)}
          className="mt-3 flex items-center gap-2 text-sm font-medium text-[var(--text-2)] hover:text-[var(--text)]"
        >
          <span className="text-base">✨</span> Summarize {label}&apos;s latest {form}
          <span className="text-[11px] font-normal text-[var(--text-4)]">— the {SUBTITLE[form]}, as a buy-side memo</span>
        </button>
      )}

      {loading && (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-[var(--text-3)]">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--text-4)] border-t-transparent" />
          Reading {label}&apos;s latest {form} from EDGAR — this takes a bit…
        </div>
      )}

      {error && !loading && (
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-[#ef4444]">
          <span>{error}</span>
          <button onClick={() => setErrByForm((p) => ({ ...p, [form]: null }))} className="text-[var(--text-4)] hover:text-[var(--text)]">✕</button>
        </div>
      )}

      {data && (
        <div className="mt-3">
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-[var(--text-2)]">📑 {data.form} — {label}</span>
            <span className="text-[11px] text-[var(--text-4)]">
              {data.date ? new Date(data.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
            </span>
          </div>
          <div className="rounded-lg border border-[var(--divider)] bg-[var(--surface-2)] p-3 text-[13px] text-[var(--text-body)]">
            <MarkdownLite text={data.summary || ""} />
          </div>
          <p className="mt-1.5 text-[10px] text-[var(--text-4)]">
            AI summary of the filing
            {data.url ? <> · <a href={data.url} target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">read it on EDGAR ↗</a></> : null}
            {" "}· verify before relying on it.
          </p>
        </div>
      )}
    </section>
  );
}
