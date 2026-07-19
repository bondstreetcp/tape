/**
 * Broker positions-CSV import for the Portfolio Cockpit — turn a Schwab / Fidelity / Robinhood (or any
 * generic) positions export into { symbol, shares } so the user uploads a file instead of typing. Auto-
 * detects the header row (skipping the broker's preamble/footer), maps a Symbol + Quantity column, and
 * skips options, cash / money-market, and total rows with a note. Pure + fs-free (tests/brokerImport.test.ts);
 * the cockpit turns the result into its SYMBOL SHARES textarea, so all downstream analytics are unchanged.
 */

import type { Position } from "./portfolio";

export interface BrokerImport {
  broker: string; // "Schwab" | "Fidelity" | "Robinhood" | "CSV"
  positions: Position[]; // merged; net-zero dropped
  skipped: string[]; // human-readable notes (options, cash, unrecognized)
}

/** Parse one CSV line into fields, honouring quoted fields with embedded commas and "" escapes. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const norm = (s: string): string => s.replace(/^"|"$/g, "").trim().toLowerCase();
const findCol = (cells: string[], want: (h: string) => boolean): number => cells.findIndex((h) => want(norm(h)));
const CASH_SYM = /^(cash|core|spaxx|fdrxx|fzfxx|fcash|swvxx|vmfxx|vmrxx|snvxx|snsxx|cash & cash investments)$/i;

export function parseBrokerCsv(text: string): BrokerImport | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");

  // Locate the header row: the first line (within the preamble) carrying a Symbol/Ticker AND a
  // Quantity/Qty/Shares column. Everything above it (broker banner, blank lines) is ignored.
  let headerIdx = -1, symCol = -1, qtyCol = -1, descCol = -1, headers: string[] = [];
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const cells = parseCsvLine(lines[i]);
    const sC = findCol(cells, (h) => h === "symbol" || h === "ticker" || h === "instrument");
    const qC = findCol(cells, (h) => h === "quantity" || h === "qty" || h === "shares" || h.startsWith("qty"));
    if (sC >= 0 && qC >= 0) {
      headerIdx = i; symCol = sC; qtyCol = qC; headers = cells;
      descCol = findCol(cells, (h) => h === "description" || h === "name" || h === "security description");
      break;
    }
  }
  if (headerIdx < 0) return null;

  const hay = lines.slice(0, headerIdx + 1).join("\n").toLowerCase();
  const broker = hay.includes("account number") && hay.includes("last price") ? "Fidelity"
    : (hay.includes("positions for account") || headers.some((h) => norm(h) === "qty (quantity)")) ? "Schwab"
    : hay.includes("robinhood") ? "Robinhood"
    : "CSV";

  const map = new Map<string, number>();
  const order: string[] = [];
  const skipped: string[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length <= Math.max(symCol, qtyCol)) continue; // footer disclaimer / short rows
    const rawSym = (cells[symCol] ?? "").replace(/["*]/g, "").trim();
    const desc = descCol >= 0 ? (cells[descCol] ?? "").toLowerCase() : "";
    const qty = Number((cells[qtyCol] ?? "").replace(/[$,"\s]/g, ""));
    if (!rawSym || /^(account total|pending activity|total|subtotal)$/i.test(rawSym)) continue;

    const sym = rawSym.toUpperCase().replace(/[./]/g, "-"); // BRK.B / BRK/B → BRK-B (Yahoo/snapshot form)
    if (/\s/.test(rawSym) || sym.length > 10) { skipped.push(`${rawSym} — option/derivative`); continue; }
    if (CASH_SYM.test(rawSym) || desc.includes("money market") || desc === "cash") { skipped.push(`${rawSym} — cash`); continue; }
    if (!/^[A-Z][A-Z.\-]{0,9}$/.test(sym)) { skipped.push(`${rawSym} — unrecognized`); continue; }
    if (!Number.isFinite(qty) || qty === 0) continue;
    if (!map.has(sym)) order.push(sym);
    map.set(sym, (map.get(sym) ?? 0) + qty);
  }

  const positions = order.map((symbol) => ({ symbol, shares: map.get(symbol)! })).filter((p) => p.shares !== 0);
  return positions.length ? { broker, positions, skipped } : null;
}
