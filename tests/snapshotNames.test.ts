import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotNames } from "../lib/data";
import type { Snapshot } from "../lib/types";

// snapshotNames turns a universe member snapshot into the {symbol,name} list the transcript backfill walks
// (BACKFILL_UNIVERSE=russell3000 -> loadSnapshot -> here). Universe snapshots are R2-hydrated, so a fresh clone
// that hasn't run data-from-r2 must fail LOUDLY, not silently backfill a stub.

const snap = (stocks: Array<Partial<{ symbol: string; name: string }>>): Snapshot =>
  ({ stocks } as unknown as Snapshot);

test("snapshotNames: keeps named rows, drops empty symbols, falls back name->symbol", () => {
  const out = snapshotNames(
    snap([
      { symbol: "AAPL", name: "Apple Inc." },
      { symbol: "BRK-B", name: "" }, // dual-class, no name -> falls back to the symbol
      { symbol: "", name: "Ghost Corp" }, // no symbol -> dropped (only symbol is load-bearing downstream)
    ]),
    "russell3000",
  );
  assert.deepEqual(out, [
    { symbol: "AAPL", name: "Apple Inc." },
    { symbol: "BRK-B", name: "BRK-B" },
  ]);
});

test("snapshotNames: a missing or empty snapshot throws the operator-actionable hydrate message", () => {
  for (const bad of [null, snap([]), { stocks: undefined } as unknown as Snapshot]) {
    assert.throws(() => snapshotNames(bad, "russell3000"), (e: Error) => {
      assert.match(e.message, /no member snapshot for universe "russell3000"/);
      assert.match(e.message, /data\/russell3000\/snapshot\.json/);
      assert.match(e.message, /hydrate it from R2 first/);
      return true;
    });
  }
});
