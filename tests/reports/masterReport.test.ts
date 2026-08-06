import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMasterReport,
  validateMonth
} from "../../src/reports/masterReport.js";

test("builds daily master totals and excludes personal transfers", () => {
  const report = buildMasterReport("2026-08", [
    {
      occurredOn: "2026-08-06",
      direction: "income",
      amount: 800,
      category: "Работа"
    },
    {
      occurredOn: "2026-08-06",
      direction: "income",
      amount: 100,
      category: "Фриланс"
    },
    {
      occurredOn: "2026-08-06",
      direction: "transfer",
      amount: 500,
      category: null
    },
    {
      occurredOn: "2026-08-06",
      direction: "expense",
      amount: 30.25,
      category: "Транспорт"
    },
    {
      occurredOn: "2026-08-07",
      direction: "expense",
      amount: 12.5,
      category: "Еда"
    },
    {
      occurredOn: "2026-07-31",
      direction: "expense",
      amount: 999,
      category: "Другое"
    }
  ]);

  assert.equal(report.currency, "EUR");
  assert.equal(report.income, 900);
  assert.equal(report.expense, 42.75);
  assert.equal(report.net, 857.25);
  assert.equal(report.days.length, 31);
  assert.deepEqual(report.days[5], {
    date: "2026-08-06",
    label: "06",
    income: 900,
    expense: 30.25
  });
  assert.deepEqual(report.expenseCategories, [
    { category: "Транспорт", amount: 30.25 },
    { category: "Еда", amount: 12.5 }
  ]);
});

test("rejects malformed report months", () => {
  assert.throws(() => validateMonth("2026-13"), /YYYY-MM/);
  assert.throws(() => validateMonth("август"), /YYYY-MM/);
});
