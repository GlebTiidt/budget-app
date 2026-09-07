import assert from "node:assert/strict";
import test from "node:test";
import { calculateBalanceTimeline, type BalanceOperation } from "../../src/budget/balanceTimeline.js";
const opening = { amount: 100, currency: "USD" as const, effectiveOn: "2026-08-01" };
const expense: BalanceOperation = { pageId: "t", sourceId: "t", kind: "transaction", occurredOn: "2026-08-01", order: 201, baseAmount: 10, effect: -10, baseCurrency: "USD", runningBalance: 999 };

test("imported opening order cannot hide confirmed operations or reuse stale derived balances", () => {
  const result = calculateBalanceTimeline(opening, { operations: [expense], anchors: [{ sourceId: "opening", pageId: "a", occurredOn: opening.effectiveOn, order: 2026080101, balance: 100, baseCurrency: "USD", createdAt: "2026-08-01T00:00:00Z" }] });
  assert.equal(result.currentBalance, 90);
  assert.equal(result.runningBalances.get("t"), 90);
});

test("chronology uses dates before message order, reconciles snapshots, and excludes pre-opening history", () => {
  const result = calculateBalanceTimeline(opening, { operations: [expense, { ...expense, sourceId: "historical", occurredOn: "2026-07-31", order: 900 }, { ...expense, sourceId: "later", occurredOn: "2026-08-03", order: 1 }], anchors: [{ sourceId: "snapshot", pageId: "a", occurredOn: "2026-08-02", order: 501, balance: 80, baseCurrency: "USD", createdAt: "2026-08-02T00:00:00Z" }] });
  assert.equal(result.currentBalance, 70);
  assert.equal(result.runningBalances.get("historical"), null);
});

test("rejects duplicate history and mixed base currencies", () => {
  assert.throws(() => calculateBalanceTimeline(opening, { operations: [expense, expense], anchors: [] }), /duplicate/);
  assert.throws(() => calculateBalanceTimeline(opening, { operations: [{ ...expense, baseCurrency: "EUR" }], anchors: [] }), /Валюта/);
});
