"use client";
import { SCREEN_INFO, type ScreenKey } from "@/lib/screens";

const ORDER: ScreenKey[] = ["magic", "erp5", "netnet", "piotroski", "shyield", "moat"];

/** ⓘ info icon → hover/focus card explaining each preset screen in detail. */
export default function StrategyTip() {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        tabIndex={0}
        aria-label="What do these screens mean?"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border)] text-[11px] font-bold leading-none text-[var(--text-3)] transition-colors hover:border-[#a855f7] hover:text-[#d8b4fe]"
      >
        i
      </button>
      <div
        role="tooltip"
        className="invisible absolute left-0 top-7 z-50 max-h-[70vh] w-[360px] overflow-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left opacity-0 shadow-2xl transition-opacity duration-100 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-3)]">Preset screens — what each one does</div>
        <div className="space-y-2.5">
          {ORDER.map((k) => {
            const s = SCREEN_INFO[k];
            return (
              <div key={k} className="border-t border-[var(--divider)] pt-2 first:border-0 first:pt-0">
                <div className="text-[13px] font-semibold text-[#d8b4fe]">{s.name}</div>
                <p className="mt-0.5 text-[11px] italic leading-snug text-[var(--text-3)]">{s.what}</p>
                <p className="mt-1 text-[11px] leading-snug text-[var(--text-2)]">{s.how}</p>
                <p className="mt-1 text-[11px] leading-snug text-[var(--text-4)]"><span className="font-medium text-[var(--text-3)]">How to read:</span> {s.read}</p>
              </div>
            );
          })}
        </div>
      </div>
    </span>
  );
}
