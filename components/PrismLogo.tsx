// The Prism brand lockup — a dispersing-prism glyph (white light splitting into the factor spectrum, the
// same idea the product runs on: one return number → the factor bets inside it) + the wide-tracked PRISM
// wordmark. Prism is the portfolio-intelligence surface inside Tape. Server-safe: pure SVG, no client hooks.

/** The dispersing-prism gem mark. `id` scopes the gradient so multiple marks on a page don't collide. */
export function PrismMark({ size = 24, id = "prismGrad" }: { size?: number; id?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#937ae6" />
          <stop offset="26%" stopColor="#5e6bec" />
          <stop offset="50%" stopColor="#3e8fd6" />
          <stop offset="72%" stopColor="#2fa79e" />
          <stop offset="100%" stopColor="#46b27a" />
        </linearGradient>
      </defs>
      <path d="M50 14 L86 80 A6 6 0 0 1 80 86 L20 86 A6 6 0 0 1 14 80 Z" fill={`url(#${id})`} opacity="0.94" />
      <path d="M50 14 L86 80 A6 6 0 0 1 80 86 L20 86 A6 6 0 0 1 14 80 Z" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.6" />
      <path d="M50 14 L50 86" stroke="rgba(255,255,255,0.32)" strokeWidth="1.3" />
    </svg>
  );
}

/** The wide-tracked wordmark. Trailing padding balances the letter-spacing on the final letter. */
export function PrismWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-[0.2em] text-[var(--text)] ${className}`} style={{ paddingLeft: "0.2em" }}>
      PRISM
    </span>
  );
}

/** Mark + wordmark lockup. */
export default function PrismLogo({ size = 24 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <PrismMark size={size} />
      <PrismWordmark className="text-[15px]" />
    </span>
  );
}
