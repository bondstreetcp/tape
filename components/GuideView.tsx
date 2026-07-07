"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { GUIDE_CONCEPTS, GUIDE_GROUPS, type GuideFeature } from "@/lib/guideContent";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UniverseSwitcher from "./UniverseSwitcher";

const hay = (f: GuideFeature) =>
  `${f.title} ${f.question} ${f.how} ${f.metrics.map((m) => m.term + " " + m.plain).join(" ")}`.toLowerCase();

const featHref = (universe: string, path: string) => (/^https?:\/\//.test(path) ? path : `/u/${universe}${path}`);

export default function GuideView({ universe }: { universe: string }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();

  const concepts = useMemo(
    () => (ql ? GUIDE_CONCEPTS.filter((c) => (c.term + " " + c.plain).toLowerCase().includes(ql)) : GUIDE_CONCEPTS),
    [ql],
  );
  const groups = useMemo(
    () =>
      GUIDE_GROUPS.map((g) => ({ ...g, features: ql ? g.features.filter((f) => hay(f).includes(ql)) : g.features })).filter(
        (g) => g.features.length > 0,
      ),
    [ql],
  );
  const nFeatures = useMemo(() => groups.reduce((n, g) => n + g.features.length, 0), [groups]);

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Guide</h1>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-[var(--text-3)]">
            What every board does and what each number means — written for someone who&apos;s taken one finance course.
            Start with <a href="#concepts" className="text-[var(--accent)] hover:underline">Concepts 101</a> if a term is new, then jump to any tool.
            Everything here is decision-support and education, <b>not investment advice</b>.
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the guide — a feature, a metric, or a term (e.g. “gamma”, “implied move”, “13F”)…"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 text-sm outline-none placeholder:text-[var(--text-4)] sm:max-w-xl"
        />
        {ql && <span className="ml-3 text-xs text-[var(--text-4)]">{concepts.length} concepts · {nFeatures} features</span>}
      </div>

      <div className="lg:grid lg:grid-cols-[13rem_1fr] lg:gap-8">
        {/* Table of contents */}
        <nav className="mb-6 lg:sticky lg:top-4 lg:mb-0 lg:self-start">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-[13px]">
            <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">On this page</div>
            {(!ql || concepts.length > 0) && (
              <a href="#concepts" className="block rounded-md px-2 py-1 text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]">Concepts 101</a>
            )}
            {groups.map((g) => (
              <a key={g.key} href={`#${g.key}`} className="block rounded-md px-2 py-1 text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
                {g.title} <span className="text-[var(--text-4)]">· {g.features.length}</span>
              </a>
            ))}
          </div>
        </nav>

        <div className="min-w-0">
          {/* Concepts 101 */}
          {(!ql || concepts.length > 0) && (
            <section id="concepts" className="mb-10 scroll-mt-4">
              <h2 className="mb-1 text-xl font-bold">Concepts 101</h2>
              <p className="mb-4 max-w-3xl text-[13px] text-[var(--text-3)]">The building blocks the rest of the guide leans on. Skim the ones you know; read the ones you don&apos;t.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {concepts.map((c) => (
                  <div key={c.term} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <h3 className="text-[14px] font-semibold text-[var(--text)]">{c.term}</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-2)]">{c.plain}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Feature groups */}
          {groups.map((g) => (
            <section key={g.key} id={g.key} className="mb-10 scroll-mt-4">
              <h2 className="mb-1 text-xl font-bold">{g.title}</h2>
              {g.blurb && <p className="mb-4 max-w-3xl text-[13px] text-[var(--text-3)]">{g.blurb}</p>}
              <div className="space-y-3">
                {g.features.map((f) => (
                  <article key={f.path + f.title} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={featHref(universe, f.path)} className="text-[15px] font-semibold text-[var(--accent)] hover:underline" {...(/^https?:\/\//.test(f.path) ? { target: "_blank", rel: "noreferrer" } : {})}>
                        {f.title}{/^https?:\/\//.test(f.path) ? " ↗" : ""}
                      </Link>
                      {f.usOnly && <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-4)]" title="Reads a US-market feed — hidden on international universes">US</span>}
                    </div>
                    <p className="mt-1 text-[13px] font-medium text-[var(--text-2)]">{f.question}</p>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-3)]">{f.how}</p>
                    {f.metrics.length > 0 && (
                      <dl className="mt-3 grid gap-x-5 gap-y-1.5 border-t border-[var(--divider)] pt-3 sm:grid-cols-2">
                        {f.metrics.map((m) => (
                          <div key={m.term} className="text-[12.5px] leading-snug">
                            <dt className="inline font-semibold text-[var(--text-2)]">{m.term}</dt>
                            <dd className="inline text-[var(--text-3)]"> — {m.plain}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}

          {ql && concepts.length === 0 && nFeatures === 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">
              Nothing in the guide matches “{q}”. Try a broader term.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
