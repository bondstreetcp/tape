import { test } from "node:test";
import assert from "node:assert/strict";
import { latestCampaignByTicker } from "../lib/cef";

// The CEF × activist join — the discount-closing catalyst next to the discount (2026-08-05).
test("latest campaign per CEF ticker; shorts excluded; non-CEF targets ignored", () => {
  const cefs = new Set(["XFLT", "DMB"]);
  const m = latestCampaignByTicker(
    [
      { ticker: "XFLT", type: "activist", campaigner: "Saba Capital", date: "2026-06-01", form: "SCHEDULE 13D", ask: "board seats", url: "u1" },
      { ticker: "XFLT", type: "activist", campaigner: "Saba Capital", date: "2026-07-15", form: "SCHEDULE 13D", ask: "tender", url: "u2" },
      { ticker: "DMB", type: "short-report", campaigner: "Some Short", date: "2026-07-01", url: "u3" }, // a short is not discount-closing pressure
      { ticker: "AAPL", type: "activist", campaigner: "X", date: "2026-07-01", url: "u4" }, // not a CEF
      { ticker: null, type: "activist", date: "2026-07-01" },
    ],
    cefs,
  );
  assert.equal(m.size, 1);
  assert.equal(m.get("XFLT")?.date, "2026-07-15"); // latest filing wins
  assert.equal(m.get("XFLT")?.ask, "tender");
  assert.equal(m.get("DMB"), undefined);
});
