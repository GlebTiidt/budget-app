import type { SupportedCurrency } from "./userSettings.js";

export type BalanceOperation = {
  pageId: string;
  sourceId: string;
  kind: "transaction" | "debt";
  occurredOn: string;
  order: number;
  effect: number;
  baseAmount: number;
  baseCurrency: SupportedCurrency;
  runningBalance: number | null;
  direction?: "income" | "expense" | "transfer";
  category?: string | null;
  description?: string;
  originalAmount?: number;
  originalCurrency?: string;
  action?: "borrow" | "repay_borrowed" | "lend" | "collect";
  counterparty?: string;
};

export type BalanceAnchor = {
  sourceId: string;
  pageId: string;
  occurredOn: string;
  order: number;
  balance: number;
  baseCurrency: SupportedCurrency;
  createdAt: string;
};

export type BudgetHistory = { operations: BalanceOperation[]; anchors: BalanceAnchor[] };
export type OpeningAnchor = { amount: number; currency: SupportedCurrency; effectiveOn: string };

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Dates define accounting chronology. Message order only breaks ties on the same day.
// The settings opening anchor is at the START of its day, regardless of import order.
export function calculateBalanceTimeline(opening: OpeningAnchor, history: BudgetHistory) {
  const initialObservation = [...history.anchors]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.sourceId.localeCompare(b.sourceId))
    .find(a => a.occurredOn === opening.effectiveOn && a.balance === opening.amount && a.baseCurrency === opening.currency);
  const events = [
    ...history.operations.map(operation => ({ ...operation, type: "operation" as const })),
    ...history.anchors.filter(a => a !== initialObservation).map(anchor => ({ ...anchor, type: "anchor" as const }))
  ].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.order - b.order || a.sourceId.localeCompare(b.sourceId));
  let balance = opening.amount;
  const runningBalances = new Map<string, number | null>();
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.sourceId)) throw new Error("Budget history contains duplicate source IDs.");
    seen.add(event.sourceId);
    if (event.baseCurrency !== opening.currency) throw new Error("Валюта истории не совпадает с основной валютой. Нужен пересчёт валюты.");
    if (event.occurredOn < opening.effectiveOn) {
      if (event.type === "operation") runningBalances.set(event.sourceId, null);
      continue;
    }
    if (event.type === "anchor") balance = event.balance;
    else {
      balance = roundMoney(balance + event.effect);
      runningBalances.set(event.sourceId, balance);
    }
  }
  return { currentBalance: roundMoney(balance), runningBalances };
}
