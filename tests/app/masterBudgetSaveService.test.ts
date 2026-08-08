import assert from "node:assert/strict";
import test from "node:test";
import { createMasterBudgetSaveService } from "../../src/app/masterBudgetSaveService.js";
import type { MasterBalanceObservationWrite } from "../../src/integrations/notion/notionMasterBalanceRepository.js";
import type { MasterDebtOperationWrite } from "../../src/integrations/notion/notionMasterDebtRepository.js";
import type { MasterLedgerTransactionWrite } from "../../src/integrations/notion/notionMasterLedgerRepository.js";
import type { OpeningBalance } from "../../src/integrations/notion/notionMasterOpeningBalanceRepository.js";
import type { ParsedBudgetMessageDraft, ParsedDebtOperationDraft, ParsedTransactionDraft } from "../../src/integrations/openai/openAiTransactionParser.js";

test("uses the first confirmed balance-only message as the opening anchor", async () => {
  const state = harness(null);
  const result = await state.service.save(input(balanceOnly(132, "2026-08-08")));
  assert.equal(result.status, "saved");
  if (result.status === "saved") {
    assert.equal(result.openingBalanceCreated, true);
    assert.equal(result.currentBalance, 132);
  }
  assert.equal(state.observations[0]?.status, "Принято пользователем");
  assert.deepEqual(state.initialized, { amount: 132, currency: "USD", effectiveOn: "2026-08-08" });
});

test("uses several wallet balances as one opening anchor", async () => {
  const state = harness(null);
  const parsed: ParsedBudgetMessageDraft = {
    transactions: [],
    debtOperations: [],
    balanceObservations: [
      { amount: 500, currency: "USD", occurredOn: "2026-08-08", account: "Карта", confidence: 1, ambiguities: [] },
      { amount: 250, currency: "USD", occurredOn: "2026-08-08", account: "Наличные", confidence: 1, ambiguities: [] }
    ],
    ambiguities: []
  };
  const result = await state.service.save(input(parsed));
  assert.equal(result.status, "saved");
  if (result.status === "saved") assert.equal(result.currentBalance, 750);
  assert.equal(state.observations.length, 2);
  assert.deepEqual(state.observations.map((item) => item.account), ["Карта", "Наличные"]);
  assert.deepEqual(state.observations.map((item) => item.acceptedBalance), [750, 750]);
  assert.deepEqual(state.observations.map((item) => item.isAnchor), [false, true]);
  assert.deepEqual(state.initialized, { amount: 750, currency: "USD", effectiveOn: "2026-08-08" });
});

test("keeps pre-anchor history out of the current balance", async () => {
  const state = harness({ amount: 1000, currency: "USD", effectiveOn: "2026-08-08" });
  const parsed: ParsedBudgetMessageDraft = {
    transactions: [
      transaction("income", 200, "2026-08-07"),
      transaction("expense", 50, "2026-08-08")
    ],
    debtOperations: [debt("borrow", 100, "2026-08-08")],
    balanceObservations: [], ambiguities: []
  };
  const result = await state.service.save(input(parsed));
  assert.equal(result.status, "saved");
  if (result.status === "saved") {
    assert.equal(result.currentBalance, 1050);
    assert.equal(result.historicalOperationCount, 1);
  }
  assert.equal(state.transactions[0]?.runningBalance, null);
  assert.equal(state.transactions[1]?.runningBalance, 950);
  assert.equal(state.debts[0]?.runningBalance, 1050);
});

test("asks for confirmation before accepting a balance outside tolerance", async () => {
  const state = harness({ amount: 1000, currency: "USD", effectiveOn: "2026-08-08" });
  const parsed = balanceOnly(800, "2026-08-08");
  const result = await state.service.save(input(parsed));
  assert.deepEqual(result, {
    status: "balance_mismatch", observedBalance: 800, calculatedBalance: 1000,
    difference: -200, tolerance: 20, baseCurrency: "USD"
  });
  assert.equal(state.observations.length, 0);
});

test("previews the calculated balance while ignoring pre-anchor history", async () => {
  const state = harness({ amount: 1000, currency: "USD", effectiveOn: "2026-08-08" });
  const parsed: ParsedBudgetMessageDraft = {
    transactions: [
      transaction("income", 200, "2026-08-07"),
      transaction("expense", 50, "2026-08-08")
    ],
    debtOperations: [], balanceObservations: [], ambiguities: []
  };
  assert.equal(await state.service.previewCurrentBalance(input(parsed)), 950);
});

function harness(opening: { amount: number; currency: "USD"; effectiveOn: string } | null) {
  const transactions: MasterLedgerTransactionWrite[] = [];
  const debts: MasterDebtOperationWrite[] = [];
  const observations: MasterBalanceObservationWrite[] = [];
  let initialized: OpeningBalance | null = null;
  const service = createMasterBudgetSaveService({
    currencyConverter: { async convert(value) { return { originalAmount: value.amount, originalCurrency: value.from, occurredOn: value.occurredOn, convertedAmount: value.amount, targetCurrency: value.to ?? "EUR", rate: 1, rateDate: value.occurredOn }; } },
    ledgerRepository: {
      async saveTransaction(value) { transactions.push(value); return { pageId: `t${transactions.length}`, created: true }; },
      async findLatestRunningBalanceAfter() { return null; },
      async findLatestRunningBalanceBetween() { return null; }
    },
    debtRepository: {
      async saveDebtOperation(value) { debts.push(value); return { pageId: `d${debts.length}`, created: true }; },
      async findLatestRunningBalanceAfter() { return null; },
      async findLatestRunningBalanceBetween() { return null; }
    },
    balanceRepository: {
      async saveObservation(value) { observations.push(value); return { pageId: `b${observations.length}`, created: true }; },
      async findLatestAccepted() { return opening ? { pageId: "anchor", sourceId: "existing:anchor:balance:1", order: 1, occurredOn: opening.effectiveOn, balance: opening.amount, baseCurrency: opening.currency } : null; }
    },
    openingBalanceRepository: {
      async find() { return opening; },
      async initialize(value) { initialized = value; return { created: true }; }
    }
  });
  return { service, transactions, debts, observations, get initialized() { return initialized; } };
}

function input(parsed: ParsedBudgetMessageDraft) {
  return { telegramUserId: "10", chatId: "10", sourceMessageId: 20, baseCurrency: "USD" as const, parsed };
}
function balanceOnly(amount: number, occurredOn: string): ParsedBudgetMessageDraft {
  return { transactions: [], debtOperations: [], balanceObservations: [{ amount, currency: "USD", occurredOn, account: null, confidence: 1, ambiguities: [] }], ambiguities: [] };
}
function transaction(direction: "income" | "expense", amount: number, occurredOn: string): ParsedTransactionDraft {
  return { amount, currency: "USD", direction, occurredOn, category: direction === "income" ? "Работа" : "Еда", account: "Карта", destinationAccount: null, description: "Тест", note: null, confidence: 1, ambiguities: [] };
}
function debt(action: "borrow", amount: number, occurredOn: string): ParsedDebtOperationDraft {
  return { amount, currency: "USD", action, occurredOn, counterparty: "Марина", account: "Карта", description: "Тестовый долг", note: null, confidence: 1, ambiguities: [] };
}
