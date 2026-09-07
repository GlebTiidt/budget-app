import assert from "node:assert/strict";
import test from "node:test";
import { createBudgetAnswerService } from "../../src/app/budgetAnswerService.js";
import type { BalanceOperation } from "../../src/budget/balanceTimeline.js";

test("answers from confirmed history, sums category expenses, and excludes transfers", async () => {
  const transaction = (id: string, direction: "income" | "expense" | "transfer", amount: number, date: string, category: string): BalanceOperation => ({ pageId: id, sourceId: id, occurredOn: date, order: 1, kind: "transaction", baseAmount: amount, baseCurrency: "USD", effect: direction === "income" ? amount : direction === "expense" ? -amount : 0, runningBalance: 999, direction, category });
  const service = createBudgetAnswerService({
    openingBalanceRepository: { async find() { return { amount: 100, currency: "USD", effectiveOn: "2026-08-01" }; }, async initialize() { throw new Error("read only"); } },
    historyRepository: { async read() { return { operations: [transaction("a", "income", 200, "2026-08-02", "Работа"), transaction("b", "expense", 15, "2026-08-03", "Подписки"), transaction("c", "expense", 5, "2026-08-03", "Подписки"), transaction("d", "transfer", 100, "2026-08-04", "")], anchors: [] }; }, async repair() { throw new Error("read only"); } }
  });
  const answer = await service.answer({ kind: "report", month: "2026-08", category: null, explainTransfer: false }, "USD");
  assert.match(answer, /Доходы: 200 USD/);
  assert.match(answer, /Расходы: 20 USD/);
  assert.match(answer, /Подписки: 20 USD/);
  assert.match(answer, /Общий остаток: 280 USD/);
  const previous = await service.answer({ kind: "report", month: "2026-07", category: null, explainTransfer: false }, "USD");
  assert.match(previous, /Расходы: 0 USD/);
});
