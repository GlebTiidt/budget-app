import assert from "node:assert/strict";
import test from "node:test";
import { applyUncategorizedReply } from "../../src/budget/draftCorrections.js";
import { isDraftFollowup, parseBudgetQuestion } from "../../src/budget/budgetQuestion.js";

test("Cyrillic negative category reply updates only unresolved expenses and retains all rows", () => {
  const transactions = Array.from({length: 36}, (_,i) => ({ amount: 1000+i, currency: "VND", direction: "expense" as const, occurredOn: "2026-08-02", category: i % 3 ? "Еда" : null, account: "Карта", destinationAccount: null, description: "Синтетическая покупка", note: null, confidence: 1, ambiguities: i % 3 ? [] : ["Укажите категорию", "Уточните дату"] }));
  const draft = { transactions, debtOperations: [], balanceObservations: [], ambiguities: [] };
  for (const reply of ["Нет категории", "нет категории?", "Без категории", "Не помню категорию"]) {
    assert.equal(isDraftFollowup(reply), true);
    assert.equal(parseBudgetQuestion(reply, "UTC", []), null);
    const result = applyUncategorizedReply(draft, reply)!;
    assert.equal(result.transactions.length, 36);
    assert.equal(result.transactions[0]!.category, "Другое");
    assert.equal(result.transactions[1]!.category, "Еда");
    assert.deepEqual(result.transactions[0]!.ambiguities, ["Уточните дату"]);
    assert.deepEqual(result.transactions.map(t=>t.amount), transactions.map(t=>t.amount));
  }
});
