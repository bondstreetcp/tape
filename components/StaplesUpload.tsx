"use client";
import { useCallback, useRef, useState } from "react";

// Upload portal for the licensed NielsenIQ / sell-side scan PDFs (2026-09-08 review #18): drag or pick a PDF
// instead of SSH-ing it into the watched folder. POSTs to /api/staples/upload, which validates + lands it in
// STAPLES_SCAN_DIR for the next nightly scan. The raw PDF is never served back.

type Result = { name: string; ok: boolean; msg: string };

export default function StaplesUpload() {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (!list.length) {
      setResults((r) => [{ name: "—", ok: false, msg: "PDF files only." }, ...r]);
      return;
    }
    setBusy(true);
    for (const file of list) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/staples/upload", { method: "POST", body: fd });
        const j = await res.json().catch(() => ({}));
        setResults((r) => [
          res.ok && j?.ok
            ? { name: j.fileName || file.name, ok: true, msg: "queued for the next nightly scan" }
            : { name: file.name, ok: false, msg: String(j?.error || `upload failed (${res.status})`) },
          ...r,
        ]);
      } catch (e) {
        setResults((r) => [{ name: file.name, ok: false, msg: String((e as Error)?.message || e).slice(0, 120) }, ...r]);
      }
    }
    setBusy(false);
  }, []);

  return (
    <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px] font-semibold text-[var(--text-2)]">Add a scan</span>
        <span className="text-[11px] text-[var(--text-4)]">licensed NielsenIQ / sell-side PDFs — stays private, never republished</span>
      </div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) void upload(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
        className={
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center transition-colors " +
          (drag ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border-strong)] hover:border-[var(--accent)]")
        }
      >
        <div className="text-[13px] text-[var(--text-2)]">{busy ? "Uploading…" : "Drop a scan PDF here, or click to choose"}</div>
        <div className="mt-0.5 text-[11px] text-[var(--text-4)]">Text-layer PDF · up to 30 MB · ingested on the next nightly scan</div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ""; }}
        />
      </div>
      {results.length > 0 && (
        <ul className="mt-2 space-y-1 text-[12px]">
          {results.slice(0, 6).map((r, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className={r.ok ? "text-[#22c55e]" : "text-[#ef4444]"}>{r.ok ? "✓" : "✕"}</span>
              <span className="text-[var(--text-3)]"><b className="text-[var(--text-2)]">{r.name}</b> — {r.msg}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
