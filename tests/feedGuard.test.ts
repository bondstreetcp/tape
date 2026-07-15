import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { writeFeedGuarded } from "../lib/feedGuard";

// buybacks.json is registered as { countPath: "rows", minCount: 300 } — the guard reads that floor
// straight from lib/dataFreshness, so these tests also pin that the two stay single-sourced.
const rows = (n: number) => ({ generatedAt: new Date().toISOString(), rows: Array.from({ length: n }, (_, i) => ({ symbol: "S" + i })) });

async function tmpdir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "feedguard-"));
}
const readCount = async (dir: string) => JSON.parse(await fs.readFile(path.join(dir, "buybacks.json"), "utf8")).rows.length;

test("THE 2026-07-15 INCIDENT: a 0-row build must NOT overwrite 495 good rows", async () => {
  const dir = await tmpdir();
  await fs.writeFile(path.join(dir, "buybacks.json"), JSON.stringify(rows(495)));
  const r = await writeFeedGuarded("buybacks.json", rows(0), { dataDir: dir });
  assert.equal(r.written, false, "an empty build must be refused");
  assert.equal(r.prevCount, 495);
  assert.equal(r.nextCount, 0);
  assert.equal(await readCount(dir), 495, "the good file must survive untouched");
  assert.match(r.reason, /KEEPING the prior file/);
});

test("first run / no prior file → allowed (nothing to protect, must not deadlock a bootstrap)", async () => {
  const dir = await tmpdir();
  const r = await writeFeedGuarded("buybacks.json", rows(10), { dataDir: dir });
  assert.equal(r.written, true);
  assert.equal(r.prevCount, null);
  assert.equal(await readCount(dir), 10);
});

test("a prior that is ITSELF below the floor can never lock the pipeline into keeping bad data", async () => {
  // This is the case that matters right now: buybacks.json is sitting at 0 rows in production. A
  // naive "block any drop" guard would compare against 0, pass, and be useless — but worse, a naive
  // "block anything under the floor" guard would refuse the RECOVERY write and freeze the feed at 0
  // forever. Recovery must always be possible.
  const dir = await tmpdir();
  await fs.writeFile(path.join(dir, "buybacks.json"), JSON.stringify(rows(0))); // today's broken state
  const r = await writeFeedGuarded("buybacks.json", rows(120), { dataDir: dir });
  assert.equal(r.written, true, "a partial recovery over a broken file must be allowed");
  assert.equal(await readCount(dir), 120);
});

test("above the floor writes even on a big drop (a quieter day is not a broken run)", async () => {
  const dir = await tmpdir();
  await fs.writeFile(path.join(dir, "buybacks.json"), JSON.stringify(rows(495)));
  const r = await writeFeedGuarded("buybacks.json", rows(310), { dataDir: dir }); // −37%, still ≥300
  assert.equal(r.written, true);
  assert.equal(await readCount(dir), 310);
});

test("a sub-floor collapse from a healthy prior is blocked (the general case)", async () => {
  const dir = await tmpdir();
  await fs.writeFile(path.join(dir, "buybacks.json"), JSON.stringify(rows(495)));
  const r = await writeFeedGuarded("buybacks.json", rows(42), { dataDir: dir }); // −91% AND under 300
  assert.equal(r.written, false);
  assert.equal(await readCount(dir), 495);
});

test("a small drop within tolerance writes normally", async () => {
  const dir = await tmpdir();
  await fs.writeFile(path.join(dir, "buybacks.json"), JSON.stringify(rows(495)));
  const r = await writeFeedGuarded("buybacks.json", rows(470), { dataDir: dir });
  assert.equal(r.written, true);
  assert.equal(await readCount(dir), 470);
});

test("an unreadable prior does not block the write (corrupt ≠ precious)", async () => {
  const dir = await tmpdir();
  await fs.writeFile(path.join(dir, "buybacks.json"), "{ not json");
  const r = await writeFeedGuarded("buybacks.json", rows(400), { dataDir: dir });
  assert.equal(r.written, true);
  assert.equal(r.prevCount, null);
});

test("a feed with no declared floor is uncountable-by-design → always writes", async () => {
  const dir = await tmpdir();
  // campaigns.json is registered age-only (no countPath/minCount) — sparse content is legitimate.
  await fs.writeFile(path.join(dir, "campaigns.json"), JSON.stringify({ campaigns: [1, 2, 3] }));
  const r = await writeFeedGuarded("campaigns.json", { campaigns: [] }, { dataDir: dir });
  assert.equal(r.written, true);
  assert.match(r.reason, /no countPath\/minCount floor declared/);
});

test("an unregistered file writes and says so (never silently swallow a typo'd filename)", async () => {
  const dir = await tmpdir();
  const r = await writeFeedGuarded("not-a-real-feed.json", { rows: [] }, { dataDir: dir });
  assert.equal(r.written, true);
  assert.match(r.reason, /not in the freshness registry/);
});
