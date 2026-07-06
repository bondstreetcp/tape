// The Tape brand lockup — the "breakout tick" mark (a price line bursting up out of the ticker-tape
// band) + the lowercase mono wordmark. Same geometry as the app icon (scripts/gen-icons.ts), with
// strokes thickened for legibility at header size (~22px, where the icon's 16.5/512 lines would
// render sub-pixel). Server-safe: pure SVG, no client hooks.

/** The square breakout-tick mark alone (favicon/app-icon artwork at UI size). */
export function TapeMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className="shrink-0">
      <rect width="100" height="100" rx="22" fill="#0d1117" stroke="#2f3946" strokeWidth="3" />
      <rect x="9" y="62" width="82" height="24" rx="6" fill="#1a2330" />
      <polyline points="20,74 34,68 45,72 58,52 70,42 82,31" fill="none" stroke="#34d68a" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="74,30 82,31 80,40" fill="none" stroke="#34d68a" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="20" cy="74" r="4.5" fill="#34d68a" />
    </svg>
  );
}

/** Mark + wordmark lockup for the header / drawer. */
export default function TapeLogo({ size = 22 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <TapeMark size={size} />
      <span className="font-mono text-[17px] font-semibold tracking-tight text-[var(--text)]">tape</span>
    </span>
  );
}
