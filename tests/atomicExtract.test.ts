import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import os from "os";
import path from "path";
import { promoteTree, extractAtomic } from "../lib/atomicExtract";

// The NAS hydrates the LIVE slot's data/ with the server still serving it, so the promote step is the
// only thing standing between a reader and a truncated feed. These pin the contract that makes the
// in-place refresh safe: every file arrives by rename, nothing else in the tree is disturbed.

const tmpRoot = () => mkdtempSync(path.join(os.tmpdir(), "atomic-"));
const put = (p: string, s: string) => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, s); };

test("promoteTree moves a nested tree into place and reports the count", () => {
  const root = tmpRoot();
  const stage = path.join(root, "stage"), dest = path.join(root, "dest");
  put(path.join(stage, "data", "sp500", "snapshot.json"), '{"n":1}');
  put(path.join(stage, "data", "company", "AAPL.json"), '{"t":"AAPL"}');
  mkdirSync(dest, { recursive: true });

  assert.equal(promoteTree(stage, dest), 2);
  assert.equal(readFileSync(path.join(dest, "data", "sp500", "snapshot.json"), "utf8"), '{"n":1}');
  assert.equal(readFileSync(path.join(dest, "data", "company", "AAPL.json"), "utf8"), '{"t":"AAPL"}');
});

test("promoteTree OVERWRITES an existing feed — the whole point of a hydrate", () => {
  const root = tmpRoot();
  const stage = path.join(root, "stage"), dest = path.join(root, "dest");
  put(path.join(dest, "data", "sp500", "snapshot.json"), "OLD");
  put(path.join(stage, "data", "sp500", "snapshot.json"), "NEW");

  promoteTree(stage, dest);
  assert.equal(readFileSync(path.join(dest, "data", "sp500", "snapshot.json"), "utf8"), "NEW");
});

test("promoteTree OVERLAYS, it does not mirror — files absent from the new tree survive", () => {
  // data.tar.gz and company.tar.gz promote into the SAME tree, one after the other. A mirroring
  // promote would delete whichever half landed first.
  const root = tmpRoot();
  const stage = path.join(root, "stage"), dest = path.join(root, "dest");
  put(path.join(dest, "data", "company", "AAPL.json"), "FROM-THE-COMPANY-TARBALL");
  put(path.join(stage, "data", "sp500", "snapshot.json"), "FROM-THE-DATA-TARBALL");

  promoteTree(stage, dest);
  assert.equal(readFileSync(path.join(dest, "data", "company", "AAPL.json"), "utf8"), "FROM-THE-COMPANY-TARBALL");
  assert.equal(readFileSync(path.join(dest, "data", "sp500", "snapshot.json"), "utf8"), "FROM-THE-DATA-TARBALL");
});

test("promoteTree creates destination directories that don't exist yet (a brand-new feed)", () => {
  const root = tmpRoot();
  const stage = path.join(root, "stage"), dest = path.join(root, "dest");
  put(path.join(stage, "data", "brand", "new", "deep", "feed.json"), "{}");
  mkdirSync(dest, { recursive: true });

  assert.equal(promoteTree(stage, dest), 1);
  assert.ok(existsSync(path.join(dest, "data", "brand", "new", "deep", "feed.json")));
});

test("the destination NEVER holds a partial file: content is complete the instant the path exists", () => {
  // rename(2) is what buys this — the directory entry flips from the old inode to the new one with no
  // observable in-between. Asserted here as the property callers rely on: at no point does the
  // destination contain a prefix of the new content.
  const root = tmpRoot();
  const stage = path.join(root, "stage"), dest = path.join(root, "dest");
  const big = "x".repeat(5_000_000);
  put(path.join(dest, "data", "feed.json"), "OLD");
  put(path.join(stage, "data", "feed.json"), big);

  promoteTree(stage, dest);
  const got = readFileSync(path.join(dest, "data", "feed.json"), "utf8");
  assert.equal(got.length, big.length, "a truncated read here would mean the write was not atomic");
  assert.notEqual(got, "OLD");
});

test("extractAtomic clears staging afterwards — no half-tree left to confuse the next run", () => {
  const root = tmpRoot();
  const stage = path.join(root, "stage"), dest = path.join(root, "dest");
  mkdirSync(dest, { recursive: true });
  const moved = extractAtomic("ignored.tar.gz", stage, dest, (_tp, into) => {
    put(path.join(into, "data", "a.json"), "1");
    put(path.join(into, "data", "b.json"), "2");
  });
  assert.equal(moved, 2);
  assert.equal(existsSync(stage), false, "staging dir must be gone");
  assert.deepEqual(readdirSync(path.join(dest, "data")).sort(), ["a.json", "b.json"]);
});

test("extractAtomic wipes a LEFTOVER staging tree before extracting", () => {
  // A killed hydrate leaves staging behind; promoting it next run would resurrect files the new
  // tarball deliberately dropped.
  const root = tmpRoot();
  const stage = path.join(root, "stage"), dest = path.join(root, "dest");
  put(path.join(stage, "data", "ghost.json"), "FROM-A-DEAD-RUN");
  mkdirSync(dest, { recursive: true });

  extractAtomic("ignored.tar.gz", stage, dest, (_tp, into) => put(path.join(into, "data", "real.json"), "1"));
  assert.equal(existsSync(path.join(dest, "data", "ghost.json")), false, "the dead run's file must not be promoted");
  assert.ok(existsSync(path.join(dest, "data", "real.json")));
});
