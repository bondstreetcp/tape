// Loading primitives — a small accent spinner + a labeled loading row. Replaces bare
// "Loading…" text for a more finished (Vercel/Stripe-style) loading state.

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={"inline-block shrink-0 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent)] " + className}
      style={{ width: size, height: size }}
    />
  );
}

export function LoadingState({
  label = "Loading…",
  className = "",
  size = 16,
}: {
  label?: string;
  className?: string;
  size?: number;
}) {
  return (
    <div role="status" className={"flex items-center justify-center gap-2 py-10 text-sm text-[var(--text-3)] " + className}>
      <Spinner size={size} />
      <span>{label}</span>
    </div>
  );
}
