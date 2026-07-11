import { test } from "node:test";
import assert from "node:assert/strict";
import { regStage, turnoverColor } from "../lib/spinoffs";

test("regStage escalates with amendments or registration age", () => {
  assert.equal(regStage({ amendments: 0, daysInReg: 10 }).label, "Newly filed");
  assert.equal(regStage({ amendments: 1, daysInReg: 10 }).label, "Progressing"); // one amendment
  assert.equal(regStage({ amendments: 0, daysInReg: 60 }).label, "Progressing"); // aged past 45d
  assert.equal(regStage({ amendments: 2, daysInReg: 30 }).label, "Late-stage"); // multiple amendments
  assert.equal(regStage({ amendments: 0, daysInReg: 130 }).label, "Late-stage"); // long in registration
});

test("turnoverColor tracks the backtested exhaustion zone", () => {
  assert.equal(turnoverColor(null), "var(--text-4)");
  assert.equal(turnoverColor(120), "#22c55e"); // ≥100% = register turned (green)
  assert.equal(turnoverColor(70), "#f59e0b"); // approaching
  assert.equal(turnoverColor(20), "var(--text-2)"); // early
});
