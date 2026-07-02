import type { ReactNode } from "react";
import UniverseSwitcher from "./UniverseSwitcher";

// Standard page intro: a title + one-line "what this is / how to read it" so every screen
// self-explains. Optional `children` render as right-aligned actions (filters, toggles).
// Pass `universe` to get the standard in-place UniverseSwitcher next to the actions — every
// top-level board should, so switching universes never requires going back Home first.
export default function PageHeader({
  title,
  desc,
  universe,
  children,
}: {
  title: string;
  desc?: string;
  universe?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">{title}</h1>
        {desc && <p className="mt-1 max-w-2xl text-sm leading-snug text-[var(--text-3)]">{desc}</p>}
      </div>
      {(children || universe) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {children}
          {universe && <UniverseSwitcher current={universe} />}
        </div>
      )}
    </div>
  );
}
