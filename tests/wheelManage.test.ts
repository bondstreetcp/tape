import { test } from "node:test";
import assert from "node:assert/strict";
import { wheelAlert, shortLegOf, type WheelPos } from "../lib/wheelManage";

const NOW = Date.parse("2026-08-30T00:00:00Z");
const DAY = 86_400_000;
const dayISO = (d: number) => new Date(NOW + d * DAY).toISOString().slice(0, 10);
const base: WheelPos = { id: "1", symbol: "X", leg: "call", shares: 100, costBasis: null, premium: 0, note: "" };
const callPos = (o: Partial<WheelPos>): WheelPos => ({ ...base, leg: "call", callStrike: 100, callExpiry: dayISO(30), ...o });
const putPos = (o: Partial<WheelPos>): WheelPos => ({ ...base, id: "2", symbol: "Y", leg: "put", putStrike: 50, putExpiry: dayISO(30), ...o });

test("shortLegOf resolves the open short leg, or null", () => {
  assert.deepEqual(shortLegOf(callPos({})), { side: "call", strike: 100, expiry: dayISO(30) });
  assert.deepEqual(shortLegOf(putPos({})), { side: "put", strike: 50, expiry: dayISO(30) });
  assert.equal(shortLegOf({ ...base, leg: "idle" }), null);
  assert.equal(shortLegOf({ ...base, leg: "shares" }), null);
  assert.equal(shortLegOf(callPos({ callStrike: null })), null); // missing details → not manageable
});

test("expired → act now", () => {
  const a = wheelAlert(callPos({ callExpiry: dayISO(-2) }), 90, NOW)!;
  assert.equal(a.severity, 3);
  assert.equal(a.flag, "Expired");
});

test("ITM into expiry (≤3d) → act now; ITM with room → roll", () => {
  const soon = wheelAlert(callPos({ callExpiry: dayISO(2) }), 110, NOW)!; // 10% ITM, 2d
  assert.equal(soon.severity, 3);
  assert.equal(soon.flag, "ITM into expiry");
  const far = wheelAlert(callPos({ callExpiry: dayISO(20) }), 110, NOW)!; // 10% ITM, 20d
  assert.equal(far.severity, 2);
  assert.equal(far.flag, "In the money");
});

test("OTM but inside the roll window (≤7d) → roll", () => {
  const a = wheelAlert(callPos({ callExpiry: dayISO(5) }), 90, NOW)!; // OTM, 5d
  assert.equal(a.severity, 2);
  assert.equal(a.flag, "Roll window");
});

test("near the strike (≤2%) with time left → watch; comfortable OTM → on track", () => {
  const near = wheelAlert(callPos({ callExpiry: dayISO(10) }), 99, NOW)!; // 1% OTM, 10d
  assert.equal(near.severity, 1);
  assert.equal(near.flag, "Near the strike");
  const ok = wheelAlert(callPos({ callExpiry: dayISO(30) }), 85, NOW)!; // 15% OTM, 30d
  assert.equal(ok.severity, 0);
});

test("put side: assignment risk is measured below the strike", () => {
  const a = wheelAlert(putPos({ putExpiry: dayISO(20) }), 45, NOW)!; // strike 50, price 45 → 10% ITM
  assert.equal(a.side, "put");
  assert.ok((a.moneynessPct as number) > 9 && (a.moneynessPct as number) < 11);
  assert.equal(a.severity, 2);
});

test("no live price → still flags on expiry, never NaN", () => {
  const roll = wheelAlert(callPos({ callExpiry: dayISO(4) }), null, NOW)!;
  assert.equal(roll.severity, 2); // roll window from DTE alone
  assert.equal(roll.moneynessPct, null);
  const ok = wheelAlert(callPos({ callExpiry: dayISO(30) }), null, NOW)!;
  assert.equal(ok.severity, 0);
});
