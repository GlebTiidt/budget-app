import assert from "node:assert/strict";
import test from "node:test";
import { calculateBudgetPreviewSummary } from "../../src/budget/previewSummary.js";

test("summarizes income, expense, and observed balances in the user currency", async () => {
  const conversionCalls: Array<{ from: string; to: string; amount: number }> = [];
  const summary = await calculateBudgetPreviewSummary(
    {
      transactions: [
        {
          amount: 800,
          currency: "USD",
          direction: "income",
          occurredOn: "2026-08-06"
        },
        {
          amount: 3_000_000,
          currency: "VND",
          direction: "income",
          occurredOn: "2026-08-06"
        },
        {
          amount: 500,
          currency: "USD",
          direction: "transfer",
          occurredOn: "2026-08-06"
        },
        {
          amount: 900_000,
          currency: "VND",
          direction: "expense",
          occurredOn: "2026-08-06"
        },
        {
          amount: 160_000,
          currency: "VND",
          direction: "expense",
          occurredOn: "2026-08-06"
        },
        {
          amount: 85_000,
          currency: "VND",
          direction: "expense",
          occurredOn: "2026-08-06"
        }
      ],
      debtOperations: [
        {
          amount: 100,
          currency: "USD",
          action: "borrow",
          occurredOn: "2026-08-06",
          counterparty: "Петя"
        },
        {
          amount: 20,
          currency: "USD",
          action: "repay_borrowed",
          occurredOn: "2026-08-06",
          counterparty: "петя"
        },
        {
          amount: 70,
          currency: "USD",
          action: "lend",
          occurredOn: "2026-08-06",
          counterparty: "Аня"
        },
        {
          amount: 10,
          currency: "USD",
          action: "collect",
          occurredOn: "2026-08-06",
          counterparty: "Аня"
        },
        {
          amount: 150,
          currency: "EUR",
          action: "borrow",
          occurredOn: "2026-08-06",
          counterparty: "Ольга"
        }
      ],
      balanceObservations: [
        {
          amount: 7_250_000,
          currency: "VND",
          occurredOn: "2026-08-06",
          account: "Вьетнамский счёт"
        }
      ]
    },
    "EUR",
    async (input) => {
      conversionCalls.push({
        from: input.from,
        to: input.to,
        amount: input.amount
      });
      return input.amount / 10;
    }
  );

  assert.equal(summary.baseCurrency, "EUR");
  assert.equal(summary.income, 300_080);
  assert.equal(summary.expense, 114_500);
  assert.deepEqual(summary.observedBalances, [
    { account: "Вьетнамский счёт", amount: 725_000 }
  ]);
  assert.deepEqual(summary.debt, {
    owedByUser: [
      { counterparty: "Ольга", currency: "EUR", amount: 150 },
      { counterparty: "Петя", currency: "USD", amount: 80 }
    ],
    owedToUser: [{ counterparty: "Аня", currency: "USD", amount: 60 }]
  });
  assert.equal(summary.incompleteOperationCount, 0);
  assert.equal(
    conversionCalls.some((call) => call.amount === 500),
    false,
    "personal transfers must not affect income or expense"
  );
  assert.equal(
    conversionCalls.some((call) =>
      [100, 20, 70, 10, 150].includes(call.amount)
    ),
    false,
    "debt must stay in its original currency"
  );
  assert.ok(conversionCalls.every((call) => call.to === "EUR"));
});

test("counts incomplete operations without inventing their totals", async () => {
  const summary = await calculateBudgetPreviewSummary(
    {
      transactions: [
        {
          amount: 50,
          currency: null,
          direction: "expense",
          occurredOn: "2026-08-06"
        }
      ],
      debtOperations: [],
      balanceObservations: []
    },
    "USD",
    async () => {
      throw new Error("incomplete operations must not be converted");
    }
  );

  assert.equal(summary.expense, 0);
  assert.equal(summary.incompleteOperationCount, 1);
});
