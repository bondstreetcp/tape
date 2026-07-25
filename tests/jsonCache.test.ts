import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { cachedFile, jsonCacheClear } from "../lib/jsonCache";

// cachedFile replaces ~47 importers' per-request multi-MB JSON.parse. Its correctness contract is
// narrow but load-bearing: never serve a value for a file that has CHANGED (the nightly hydrate
// rewrites data/), never serve one for a file that is GONE, and never turn a missing/malformed feed
// into an error (every caller treats that as "not built yet").

const tmp = async () => fs.mkdtemp(path.join(os.tmpdir(), "jsoncache-"));
beforeEach(() => jsonCacheClear());

test("second read is served from cache — the file is parsed once", async () => {
  const dir = await tmp(), f = path.join(dir, "a.json");
  await fs.writeFile(f, JSON.stringify({ n: 1 }));
  let builds = 0;
  const build = (raw: string) => { builds++; return JSON.parse(raw) as { n: number }; };
  assert.equal((await cachedFile(f, build))!.n, 1);
  assert.equal((await cachedFile(f, build))!.n, 1);
  assert.equal(builds, 1, "the second call must not re-parse");
});

test("a rewritten file is picked up on the very next call (no TTL to wait out)", async () => {
  const dir = await tmp(), f = path.join(dir, "a.json");
  await fs.writeFile(f, JSON.stringify({ n: 1 }));
  const build = (raw: string) => JSON.parse(raw) as { n: number };
  assert.equal((await cachedFile(f, build))!.n, 1);
  await fs.writeFile(f, JSON.stringify({ n: 22 })); // different size → stamp differs
  assert.equal((await cachedFile(f, build))!.n, 22, "the nightly hydrate must invalidate immediately");
});

test("missing file → null, and a previously cached value is dropped (never serve a deleted feed)", async () => {
  const dir = await tmp(), f = path.join(dir, "a.json");
  await fs.writeFile(f, JSON.stringify({ n: 1 }));
  const build = (raw: string) => JSON.parse(raw) as { n: number };
  assert.equal((await cachedFile(f, build))!.n, 1);
  await fs.rm(f);
  assert.equal(await cachedFile(f, build), null);
  // and it stays null rather than resurrecting the cached object
  assert.equal(await cachedFile(f, build), null);
});

test("malformed JSON → null, and a REPAIRED file is picked up immediately (new stamp beats the negative entry)", async () => {
  const dir = await tmp(), f = path.join(dir, "a.json");
  await fs.writeFile(f, "{ not json");
  let builds = 0;
  const build = (raw: string) => { builds++; return JSON.parse(raw) as unknown; };
  assert.equal(await cachedFile(f, build), null);
  await fs.writeFile(f, JSON.stringify({ ok: true }));
  assert.deepEqual(await cachedFile(f, build), { ok: true }, "a repaired file must be read, not skipped");
  assert.equal(builds, 2);
});

test("a build that throws (loader's 'not built yet' signal) yields null, matching the old try/catch", async () => {
  const dir = await tmp(), f = path.join(dir, "a.json");
  await fs.writeFile(f, JSON.stringify({ daily: [] }));
  // mirrors loadMarketSeries: an empty series is 'not built', signalled by throwing inside build
  const build = (raw: string) => { const j = JSON.parse(raw) as { daily?: unknown[] }; if (!j.daily?.length) throw new Error("no daily"); return j.daily; };
  assert.equal(await cachedFile(f, build), null);
});

test("in-flight dedup: concurrent cold reads parse once (no 5×3MB stampede)", async () => {
  const dir = await tmp(), f = path.join(dir, "a.json");
  await fs.writeFile(f, JSON.stringify({ n: 7 }));
  let builds = 0;
  const build = (raw: string) => { builds++; return JSON.parse(raw) as { n: number }; };
  const all = await Promise.all([cachedFile(f, build), cachedFile(f, build), cachedFile(f, build), cachedFile(f, build), cachedFile(f, build)]);
  assert.deepEqual(all.map((r) => r!.n), [7, 7, 7, 7, 7]);
  assert.equal(builds, 1, "five concurrent callers must share one parse");
});

test("distinct files are cached independently", async () => {
  const dir = await tmp();
  const a = path.join(dir, "a.json"), b = path.join(dir, "b.json");
  await fs.writeFile(a, JSON.stringify({ v: "a" }));
  await fs.writeFile(b, JSON.stringify({ v: "b" }));
  const build = (raw: string) => JSON.parse(raw) as { v: string };
  assert.equal((await cachedFile(a, build))!.v, "a");
  assert.equal((await cachedFile(b, build))!.v, "b");
  assert.equal((await cachedFile(a, build))!.v, "a");
});

test("bounded: the cache evicts rather than growing without limit", async () => {
  const dir = await tmp();
  const build = (raw: string) => JSON.parse(raw) as { i: number };
  for (let i = 0; i < 70; i++) { // MAX_ENTRIES is 64
    const f = path.join(dir, `f${i}.json`);
    await fs.writeFile(f, JSON.stringify({ i }));
    assert.equal((await cachedFile(f, build))!.i, i);
  }
  // the earliest key must have been evicted → re-reading it rebuilds
  let rebuilt = false;
  const f0 = path.join(dir, "f0.json");
  await cachedFile(f0, (raw) => { rebuilt = true; return JSON.parse(raw) as { i: number }; });
  assert.equal(rebuilt, true, "oldest entry should have been evicted past the bound");
});

// ── regressions from the adversarial review (2026-07-24) ─────────────────────────────────────────

test("REVIEW #1 (high): a write landing DURING the read must not be cached under the new stamp", async () => {
  // The original bug: re-stat after reading and store under the AFTER stamp → bytes read at T1 keyed
  // by the file's state at T2. Lookup is an exact stamp match, so that entry NEVER expires: the old
  // content is served forever. Reproduced here by writing from inside `build`, which is exactly the
  // blocking-parse window a separate process would land in.
  const dir = await tmp(), f = path.join(dir, "a.json");
  await fs.writeFile(f, JSON.stringify({ price: 100 }));
  const build = (raw: string) => {
    const v = JSON.parse(raw) as { price: number };
    if (v.price === 100) require("fs").writeFileSync(f, JSON.stringify({ price: 999 })); // writer lands mid-parse
    return v;
  };
  assert.equal((await cachedFile(f, build))!.price, 100, "this call legitimately returns what it read");
  // …but the next call must see the file that is actually on disk now, not a poisoned cache entry.
  const after = await cachedFile(f, (raw) => JSON.parse(raw) as { price: number });
  assert.equal(after!.price, 999, "a mid-read write must leave the cache COLD, never pinned to stale bytes");
});

test("REVIEW #3: a malformed feed is negative-cached, so it costs one parse per rewrite not per request", async () => {
  const dir = await tmp(), f = path.join(dir, "a.json");
  await fs.writeFile(f, "{ not json");
  let builds = 0;
  const build = (raw: string) => { builds++; return JSON.parse(raw) as unknown; };
  assert.equal(await cachedFile(f, build), null);
  assert.equal(await cachedFile(f, build), null);
  assert.equal(await cachedFile(f, build), null);
  assert.equal(builds, 1, "a broken feed must not re-parse on every single request");
  // …and a repaired file is still picked up immediately (the stamp changed)
  await fs.writeFile(f, JSON.stringify({ ok: true }));
  assert.deepEqual(await cachedFile(f, build), { ok: true });
  assert.equal(builds, 2);
});

test("REVIEW #2: an in-flight read is only shared with callers that saw the SAME file state", async () => {
  const dir = await tmp(), f = path.join(dir, "a.json");
  await fs.writeFile(f, JSON.stringify({ n: 1 }));
  let builds = 0;
  const slow = async () => cachedFile(f, (raw) => { builds++; return JSON.parse(raw) as { n: number }; });
  const first = slow();                       // starts against {n:1}
  await fs.writeFile(f, JSON.stringify({ n: 22 })); // file moves on before the joiner arrives
  const second = await slow();                // must NOT inherit the {n:1} read
  await first;
  assert.equal(second!.n, 22, "a caller that saw the newer file must not be handed the older read");
  assert.equal(builds, 2, "different file states must not dedup into one read");
});

// ── stale-carry across an in-place hydrate ──────────────────────────────────────────────────────
// The NAS refreshes data/ underneath a live server. scripts/data-from-r2 now promotes each feed with
// an atomic rename so a truncated read should be impossible — these pin the reader-side backstop for
// when it happens anyway (a partial write from any other source, a feed a loader rejects mid-swap).
// Returning null there is NOT cheap: Next's ISR pins the empty render for the whole revalidate period,
// so ~10s of bad file becomes ~10 min of an empty board.

test("a feed that goes unparseable keeps serving its LAST GOOD parse, not an empty board", async () => {
  const dir = await tmp(), f = path.join(dir, "a.json");
  await fs.writeFile(f, JSON.stringify({ rows: [1, 2, 3] }));
  const build = (raw: string) => JSON.parse(raw) as { rows: number[] };
  assert.deepEqual(await cachedFile(f, build), { rows: [1, 2, 3] });

  await fs.writeFile(f, '{"rows":[1,2'); // truncated, as a reader mid-write would see
  assert.deepEqual(await cachedFile(f, build), { rows: [1, 2, 3] }, "must degrade to STALE, not to EMPTY");
});

test("…and the moment the file is whole again, the new value wins", async () => {
  const dir = await tmp(), f = path.join(dir, "a.json");
  const build = (raw: string) => JSON.parse(raw) as { rows: number[] };
  await fs.writeFile(f, JSON.stringify({ rows: [1] }));
  assert.deepEqual(await cachedFile(f, build), { rows: [1] });
  await fs.writeFile(f, '{"rows":[9,9');
  assert.deepEqual(await cachedFile(f, build), { rows: [1] }, "carried");
  await fs.writeFile(f, JSON.stringify({ rows: [9, 9, 9] }));
  assert.deepEqual(await cachedFile(f, build), { rows: [9, 9, 9] }, "the completed write must take over immediately");
});

test("a feed that NEVER parsed is still null — the carry needs something good to carry", async () => {
  const dir = await tmp(), f = path.join(dir, "a.json");
  await fs.writeFile(f, "{ not json");
  assert.equal(await cachedFile(f, (raw) => JSON.parse(raw) as unknown), null);
});

test("the carry is BOUNDED — a permanently broken feed stops being masked and surfaces as null", async () => {
  // An unbounded carry would serve a corrupt feed forever AND hide it from the freshness monitor:
  // trading a visible outage for an invisible one, which is the trap this codebase keeps re-learning.
  const dir = await tmp(), f = path.join(dir, "a.json");
  const build = (raw: string) => JSON.parse(raw) as { rows: number[] };
  const realNow = Date.now;
  try {
    await fs.writeFile(f, JSON.stringify({ rows: [1] }));
    assert.deepEqual(await cachedFile(f, build), { rows: [1] });

    await fs.writeFile(f, '{"rows":[1'); // broken, and it stays broken
    const t0 = realNow();
    Date.now = () => t0 + 6 * 60_000; // past STALE_CARRY_MS (5 min)
    assert.equal(await cachedFile(f, build), null, "after the window a broken feed must read as not-built");
  } finally {
    Date.now = realNow;
  }
});

test("the carry window runs from the last GOOD parse — repeated failures don't renew it", async () => {
  // The subtle half: `at` is INHERITED by a carried entry. If each failed parse re-stamped it, a feed
  // rewritten every minute by a broken producer would be masked indefinitely.
  const dir = await tmp(), f = path.join(dir, "a.json");
  const build = (raw: string) => JSON.parse(raw) as { rows: number[] };
  const realNow = Date.now;
  try {
    await fs.writeFile(f, JSON.stringify({ rows: [1] }));
    assert.deepEqual(await cachedFile(f, build), { rows: [1] });
    const t0 = realNow();

    Date.now = () => t0 + 60_000;      // 1 min later: inside the window, carries
    await fs.writeFile(f, '{"rows":[1');
    assert.deepEqual(await cachedFile(f, build), { rows: [1] }, "still inside the window");

    Date.now = () => t0 + 6 * 60_000;  // 6 min after the GOOD parse, not after the last failure
    await fs.writeFile(f, '{"rows":[1,');
    assert.equal(await cachedFile(f, build), null, "the window must not have been renewed by the first failure");
  } finally {
    Date.now = realNow;
  }
});
