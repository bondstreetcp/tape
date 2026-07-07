"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY } from "@/lib/glossary";

// A small "?" that reveals a plain-English definition on hover/focus/tap. Pass a glossary `term`
// (looked up in lib/glossary.ts) or free-form `text`. Renders nothing if neither resolves,
// so it's safe to sprinkle next to any label: <InfoDot term="IV rank" />.
//
// The bubble is PORTALED to <body> and fixed-positioned from the trigger's rect — an in-place
// absolute tooltip gets clipped by any overflow-x-auto ancestor, and almost every table on the
// site lives in one (that's why tooltips "didn't display"). Same cure as the nav dropdown.

const W = 224; // bubble width (w-56)

export default function InfoDot({ term, text, className = "" }: { term?: string; text?: string; className?: string }) {
  const body = text || (term ? GLOSSARY[term] : "") || "";
  const ref = useRef<HTMLSpanElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);

  // A fixed bubble goes stale the moment the page (or an inner table) scrolls — just hide it.
  useEffect(() => {
    if (!pos) return;
    const hide = () => setPos(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); };
  }, [pos]);

  if (!body) return null;

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.top < 96; // near the viewport top → open downward instead
    setPos({
      x: Math.min(Math.max(r.left + r.width / 2, W / 2 + 8), window.innerWidth - W / 2 - 8),
      y: below ? r.bottom + 6 : r.top - 6,
      below,
    });
  };
  const hide = () => setPos(null);

  return (
    <span
      ref={ref}
      className={"inline-flex cursor-help align-middle " + className}
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span className={"flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px] font-bold leading-none transition-colors " + (pos ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border-strong)] text-[var(--text-4)]")}>?</span>
      {pos &&
        createPortal(
          <span
            role="tooltip"
            style={{ position: "fixed", left: pos.x, top: pos.y, width: W, transform: pos.below ? "translateX(-50%)" : "translate(-50%, -100%)" }}
            className="pointer-events-none z-[70] block rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-left text-xs font-normal normal-case leading-snug tracking-normal text-[var(--text-2)] shadow-[var(--shadow-md)]"
          >
            {term && <span className="mb-0.5 block font-semibold text-[var(--text)]">{term}</span>}
            {body}
          </span>,
          document.body,
        )}
    </span>
  );
}
