import assert from "node:assert/strict";
import test from "node:test";
import { normalizeParsedBudgetMessage } from "../../../src/integrations/openai/openAiTransactionParser.js";

test("normalizes a multi-transaction message without merging its operations", () => {
  const parsed = normalizeParsedBudgetMessage({
    transactions: [
      transaction({
        amount: 240,
        currency: "usd",
        direction: "income",
        category: " Работа ",
        description: " Аванс "
      }),
      transaction({
        amount: 1_800_000,
        currency: "vnd",
        direction: "expense",
        category: "Покупки",
        description: "Визаран"
      }),
      transaction({
        amount: 25,
        currency: "usd",
        direction: "expense",
        category: "Другое",
        description: "Виза"
      }),
      transaction({
        amount: 420_000,
        currency: "vnd",
        direction: "expense",
        category: "Транспорт",
        description: "Билет"
      }),
      transaction({
        amount: 9,
        currency: "usd",
        direction: "expense",
        category: "Подписки",
        description: "OpenAI API"
      })
    ],
    debtOperations: [],
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
      { direction: "income", amount: 240, currency: "USD" },
      { direction: "expense", amount: 1_800_000, currency: "VND" },
      { direction: "expense", amount: 25, currency: "USD" },
      { direction: "expense", amount: 420_000, currency: "VND" },
      { direction: "expense", amount: 9, currency: "USD" }
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
    debtOperations: [],
    balanceObservations: [],
    ambiguities: []
  });

  assert.equal(parsed.transactions[0]?.amount, null);
  assert.equal(parsed.transactions[0]?.currency, null);
  assert.deepEqual(parsed.transactions[0]?.ambiguities, [
    "Сумма и валюта аванса не указаны"
  ]);
});

test("normalizes both accounts of a personal transfer", () => {
  const parsed = normalizeParsedBudgetMessage({
    transactions: [
      transaction({
        amount: 177,
        currency: "usd",
        direction: "transfer",
        category: null,
        account: " Crypto ",
        destinationAccount: " Вьетнамский счёт ",
        description: "Перевод аванса"
      })
    ],
    debtOperations: [],
    balanceObservations: [],
    ambiguities: []
  });

  assert.equal(parsed.transactions[0]?.account, "Crypto");
  assert.equal(
    parsed.transactions[0]?.destinationAccount,
    "Вьетнамский счёт"
  );
});

test("drops an invented no-op transfer between the same account", () => {
  const parsed = normalizeParsedBudgetMessage({
    transactions: [
      transaction({
        direction: "transfer",
        category: null,
        account: "Вьетнамский счёт",
        destinationAccount: "Вьетнамский счёт",
        description: "Лишний перевод"
      })
    ],
    debtOperations: [],
    balanceObservations: [],
    ambiguities: []
  });

  assert.deepEqual(parsed.transactions, []);
});

test("keeps four debt actions separate from income and expense", () => {
  const parsed = normalizeParsedBudgetMessage({
    transactions: [],
    debtOperations: [
      debtOperation({ action: "borrow", counterparty: " Петя " }),
      debtOperation({ action: "repay_borrowed", counterparty: "Петя" }),
      debtOperation({ action: "lend", counterparty: "Аня" }),
      debtOperation({ action: "collect", counterparty: "Аня" })
    ],
    balanceObservations: [],
    ambiguities: []
  });

  assert.deepEqual(
    parsed.debtOperations.map(({ action, counterparty }) => ({
      action,
      counterparty
    })),
    [
      { action: "borrow", counterparty: "Петя" },
      { action: "repay_borrowed", counterparty: "Петя" },
      { action: "lend", counterparty: "Аня" },
      { action: "collect", counterparty: "Аня" }
    ]
  );
  assert.equal(parsed.transactions.length, 0);
});

test("rejects invalid nested parser data before it reaches Telegram", () => {
  assert.throws(
    () =>
      normalizeParsedBudgetMessage({
        transactions: [transaction({ amount: -10 })],
        debtOperations: [],
        balanceObservations: [],
        ambiguities: []
      }),
    /transactions\[0\]\.amount/
  );

  assert.throws(
    () =>
      normalizeParsedBudgetMessage({
        transactions: [],
        debtOperations: [],
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
    destinationAccount: null,
    description: "Тест",
    note: null,
    confidence: 0.9,
    ambiguities: [],
    ...overrides
  };
}

function debtOperation(overrides: Record<string, unknown> = {}) {
  return {
    amount: 50,
    currency: "USD",
    action: "borrow",
    occurredOn: "2026-08-04",
    counterparty: null,
    account: "Карта",
    description: "Долг",
    note: null,
    confidence: 0.9,
    ambiguities: [],
    ...overrides
  };
}
