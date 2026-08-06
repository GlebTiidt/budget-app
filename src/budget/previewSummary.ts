import type { SupportedCurrency } from "./userSettings.js";

type SummaryTransaction = {
  amount: number | null;
  currency: string | null;
  direction: "expense" | "income" | "transfer";
  occurredOn: string;
};

type SummaryBalanceObservation = {
  amount: number;
  currency: string;
  occurredOn: string;
  account: string | null;
};

export type BudgetMessageForSummary = {
  transactions: SummaryTransaction[];
  balanceObservations: SummaryBalanceObservation[];
};

export type ConvertMoney = (input: {
  amount: number;
  from: string;
  to: SupportedCurrency;
  occurredOn: string;
}) => Promise<number>;

export type BudgetPreviewSummary = {
  baseCurrency: SupportedCurrency;
  income: number;
  expense: number;
  incompleteOperationCount: number;
  observedBalances: Array<{
    account: string | null;
    amount: number;
  }>;
};

export async function calculateBudgetPreviewSummary(
  message: BudgetMessageForSummary,
  baseCurrency: SupportedCurrency,
  convertMoney: ConvertMoney
): Promise<BudgetPreviewSummary> {
  const includedTransactions = message.transactions.filter(
    (transaction) => transaction.direction !== "transfer"
  );
  const completeTransactions = includedTransactions.filter(
    (
      transaction
    ): transaction is SummaryTransaction & { amount: number; currency: string } =>
      transaction.amount !== null && transaction.currency !== null
  );

  const convertedTransactions = await Promise.all(
    completeTransactions.map(async (transaction) => ({
      direction: transaction.direction,
      amount: await convertMoney({
        amount: transaction.amount,
        from: transaction.currency,
        to: baseCurrency,
        occurredOn: transaction.occurredOn
      })
    }))
  );

  const observedBalances = await Promise.all(
    message.balanceObservations.map(async (observation) => ({
      account: observation.account,
      amount: await convertMoney({
        amount: observation.amount,
        from: observation.currency,
        to: baseCurrency,
        occurredOn: observation.occurredOn
      })
    }))
  );

  return {
    baseCurrency,
    income: roundMoney(
      convertedTransactions
        .filter((transaction) => transaction.direction === "income")
        .reduce((sum, transaction) => sum + transaction.amount, 0)
    ),
    expense: roundMoney(
      convertedTransactions
        .filter((transaction) => transaction.direction === "expense")
        .reduce((sum, transaction) => sum + transaction.amount, 0)
    ),
    incompleteOperationCount:
      includedTransactions.length - completeTransactions.length,
    observedBalances
  };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
