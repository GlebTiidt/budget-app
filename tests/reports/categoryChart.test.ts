import assert from "node:assert/strict";
import test from "node:test";
import { buildCategoryExpensesChart } from "../../src/reports/categoryChart.js";

test("category chart keeps positive totals, sorts them, and rounds EUR values", () => {
  const chart = buildCategoryExpensesChart(
    [
      { category: "Transport", amountEur: 12.345 },
      { category: "Food", amountEur: 80 },
      { category: "Ignored", amountEur: 0 }
    ],
    "July 2026"
  );

  assert.equal(chart.type, "doughnut");
  assert.deepEqual(chart.data.labels, ["Food", "Transport"]);
  assert.deepEqual(chart.data.datasets[0]?.data, [80, 12.35]);
  assert.equal(chart.options.plugins.title.text, "July 2026");
});
