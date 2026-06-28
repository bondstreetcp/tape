import type { ReactNode } from "react";

// Standard page intro: a title + one-line "what this is / how to read it" so every screen
// self-explains. Optional `children` render as right-aligned actions (filters, toggles).
export default function PageHeader({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--text)]">{title}</h1>
        {desc && <p className="mt-1 max-w-2xl text-sm leading-snug text-[var(--text-3)]">{desc}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
