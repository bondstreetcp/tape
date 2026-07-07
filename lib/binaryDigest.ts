/**
 * Weekly binary-events digest — formats the impact-ranked binary-week board (lib/binaryWeek) into a
 * push message: markdown (Slack / Discord / generic webhook) + HTML (email). Pure formatting only, so
 * it's unit-testable; the delivery lives in scripts/push-binary-digest.ts.
 */
import type { BinaryEvent } from "./binaryWeek";
import { BINARY_META } from "./binaryWeek";

export interface Digest {
  title: string;
  markdown: string; // for a webhook (Slack `text` / Discord `content`)
  html: string; // for an email body
  count: number;
  hardCount: number;
}

const dayLabel = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const move = (e: BinaryEvent) => (e.impliedMovePct != null ? `±${Math.round(e.impliedMovePct)}%` : "—");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Build the digest from a pre-filtered, impact-ranked event list. `weekOf` + `baseUrl` injected (pure). */
export function buildDigest(events: BinaryEvent[], opts: { weekOf: string; baseUrl?: string; max?: number }): Digest {
  const max = opts.max ?? 20;
  const hardCount = events.filter((e) => e.hardBinary).length;
  const top = events.slice(0, max);
  const title = `Binary Events — week of ${dayLabel(opts.weekOf)}`;
  const boardUrl = opts.baseUrl ? `${opts.baseUrl.replace(/\/$/, "")}/u/sp500/binary-week` : null;

  const lead = `*${title}*\n${events.length} dated catalyst${events.length === 1 ? "" : "s"} that can move a stock this week — ${hardCount} hard ${hardCount === 1 ? "binary" : "binaries"} (◆ FDA decisions & clinical readouts), ranked by the options-implied move.`;
  const mdRows = top.map((e) => {
    const flag = e.hardBinary ? "◆ " : "";
    const impl = e.impliedMovePct != null ? `${move(e)} implied` : "no listed options";
    return `${flag}*${e.ticker}* — ${e.label}${e.detail ? ` · ${e.detail}` : ""} · _${impl}_ · ${dayLabel(e.date)} (in ${e.daysTo}d)`;
  });
  const markdown = [lead, "", ...mdRows, "", boardUrl ? `Full board → ${boardUrl}` : "", "_Research / decision-support, not advice._"].filter((x) => x !== null).join("\n");

  const htmlRows = top.map((e) => {
    const m = BINARY_META[e.kind];
    const flag = e.hardBinary ? `<span style="color:${m.color}">◆</span> ` : "";
    const impl = e.impliedMovePct != null ? `<b>${move(e)}</b> implied` : "no listed options";
    return `<tr><td style="padding:6px 10px 6px 0;white-space:nowrap;color:#64748b;font-size:13px">${esc(dayLabel(e.date))}<br><span style="color:#94a3b8">in ${e.daysTo}d</span></td>` +
      `<td style="padding:6px 0"><b>${flag}${esc(e.ticker)}</b> <span style="color:${m.color};font-size:12px">${esc(m.label)}</span>` +
      `${e.detail ? `<br><span style="color:#475569;font-size:13px">${esc(e.detail)}</span>` : ""}</td>` +
      `<td style="padding:6px 0 6px 10px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${impl}</td></tr>`;
  });
  const html =
    `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:640px">` +
    `<h2 style="margin:0 0 4px">${esc(title)}</h2>` +
    `<p style="margin:0 0 14px;color:#475569;font-size:14px">${events.length} dated catalyst${events.length === 1 ? "" : "s"} this week — ${hardCount} hard ${hardCount === 1 ? "binary" : "binaries"} (◆ FDA decisions &amp; clinical readouts), ranked by the options-implied move.</p>` +
    `<table style="border-collapse:collapse;width:100%">${htmlRows.join("")}</table>` +
    (boardUrl ? `<p style="margin:14px 0 0"><a href="${boardUrl}" style="color:#2563eb">Open the full board →</a></p>` : "") +
    `<p style="margin:10px 0 0;color:#94a3b8;font-size:12px">Research / decision-support, not advice.</p></div>`;

  return { title, markdown, html, count: events.length, hardCount };
}
