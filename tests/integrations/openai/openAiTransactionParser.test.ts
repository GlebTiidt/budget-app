import assert from "node:assert/strict";
import test from "node:test";
import { normalizeParsedBudgetMessage } from "../../../src/integrations/openai/openAiTransactionParser.js";

test("normalizes a multi-transaction message without merging its operations", () => {
  const parsed = normalizeParsedBudgetMessage({
    transactions: [
      transaction({
        amount: 177,
        currency: "usd",
        direction: "income",
        category: " Работа ",
        description: " Аванс "
      }),
      transaction({
        amount: 2_250_000,
        currency: "vnd",
        direction: "expense",
        category: "Покупки",
        description: "Визаран"
      }),
      transaction({
        amount: 30,
        currency: "usd",
        direction: "expense",
        category: "Другое",
        description: "Виза"
      }),
      transaction({
        amount: 500_000,
        currency: "vnd",
        direction: "expense",
        category: "Транспорт",
        description: "Билет"
      }),
      transaction({
        amount: 11,
        currency: "usd",
        direction: "expense",
        category: "Подписки",
        description: "OpenAI API"
      })
    ],
    balanceObservations: [
      {
        amount: 20_000,
        currency: "vnd",
        occurredOn: "2026-08-04",
        account: null,
        confidence: 0.7,
        ambiguities: [" Не указан счёт "]
      }
    ],
    ambiguities: []
  });

  assert.equal(parsed.transactions.length, 5);
  assert.deepEqual(
    parsed.transactions.map(({ direction, amount, currency }) => ({
      direction,
      amount,
      currency
    })),
    [
      { direction: "income", amount: 177, currency: "USD" },
      { direction: "expense", amount: 2_250_000, currency: "VND" },
      { direction: "expense", amount: 30, currency: "USD" },
      { direction: "expense", amount: 500_000, currency: "VND" },
      { direction: "expense", amount: 11, currency: "USD" }
    ]
  );
  assert.equal(parsed.transactions[0]?.category, "Работа");
  assert.equal(parsed.transactions[0]?.description, "Аванс");
  assert.deepEqual(parsed.balanceObservations[0]?.ambiguities, ["Не указан счёт"]);
});

test("allows missing transaction amount or currency to remain explicit", () => {
  const parsed = normalizeParsedBudgetMessage({
    transactions: [
      transaction({
        amount: null,
        currency: null,
        direction: "income",
        category: "Работа",
        description: "Аванс",
        confidence: 0.2,
        ambiguities: ["Сумма и валюта аванса не указаны"]
      })
    ],
    balanceObservations: [],
    ambiguities: []
  });

  assert.equal(parsed.transactions[0]?.amount, null);
  assert.equal(parsed.transactions[0]?.currency, null);
  assert.deepEqual(parsed.transactions[0]?.ambiguities, [
    "Сумма и валюта аванса не указаны"
  ]);
});

test("rejects invalid nested parser data before it reaches Telegram", () => {
  assert.throws(
    () =>
      normalizeParsedBudgetMessage({
        transactions: [transaction({ amount: -10 })],
        balanceObservations: [],
        ambiguities: []
      }),
    /transactions\[0\]\.amount/
  );

  assert.throws(
    () =>
      normalizeParsedBudgetMessage({
        transactions: [],
        balanceObservations: "not-an-array",
        ambiguities: []
      }),
    /balanceObservations array/
  );
});

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    amount: 50,
    currency: "USD",
    direction: "expense",
    occurredOn: "2026-08-04",
    category: "Другое",
    account: null,
    description: "Тест",
    note: null,
    confidence: 0.9,
    ambiguities: [],
    ...overrides
  };
}
