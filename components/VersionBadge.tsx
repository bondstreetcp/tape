/**
 * A tiny always-on build stamp so you can tell at a glance which deploy is live: package version +
 * git short-SHA (+ build time in the tooltip). The values are baked in at build by next.config.mjs
 * (`env`), so this is a pure server component — no client JS, no hydration risk (the string is
 * identical on server and client). Fixed to the bottom-right, theme-aware + subtle; hover to brighten
 * and read the full tooltip; triple-click to copy. Styled via `.version-badge` in globals.css.
 */
export default function VersionBadge() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";
  const sha = process.env.NEXT_PUBLIC_GIT_SHA || "dev";
  const built = process.env.NEXT_PUBLIC_BUILD_TIME || "";

  // Build time is a fixed ISO string baked at build — deterministic, so no server/client drift.
  const builtLabel = /^\d{4}-\d{2}-\d{2}T/.test(built)
    ? `${built.slice(0, 16).replace("T", " ")} UTC`
    : "";
  const title = `Tape v${version} · commit ${sha}${builtLabel ? ` · built ${builtLabel}` : ""}`;

  return (
    <div className="version-badge" title={title}>
      {`v${version}·${sha}`}
    </div>
  );
}
