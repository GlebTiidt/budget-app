import type { SupportedCurrency } from "./userSettings.js";
import type { DebtAction } from "./types.js";

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

type SummaryDebtOperation = {
  amount: number | null;
  currency: string | null;
  action: DebtAction;
  occurredOn: string;
  counterparty: string | null;
};

export type BudgetMessageForSummary = {
  transactions: SummaryTransaction[];
  debtOperations: SummaryDebtOperation[];
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
  debt: {
    owedByUser: DebtPosition[];
    owedToUser: DebtPosition[];
  };
};

export type DebtPosition = {
  counterparty: string | null;
  currency: string;
  amount: number;
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

  const completeDebtOperations = message.debtOperations.filter(
    (
      operation
    ): operation is SummaryDebtOperation & { amount: number; currency: string } =>
      operation.amount !== null && operation.currency !== null
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
      includedTransactions.length -
      completeTransactions.length +
      message.debtOperations.length -
      completeDebtOperations.length,
    observedBalances,
    debt: {
      owedByUser: buildDebtPositions(
        completeDebtOperations,
        new Set<DebtAction>(["borrow", "repay_borrowed"])
      ),
      owedToUser: buildDebtPositions(
        completeDebtOperations,
        new Set<DebtAction>(["lend", "collect"])
      )
    }
  };
}

function buildDebtPositions(
  operations: Array<
    SummaryDebtOperation & { amount: number; currency: string }
  >,
  actions: ReadonlySet<DebtAction>
): DebtPosition[] {
  const positions = new Map<
    string,
    { counterparty: string | null; currency: string; amount: number }
  >();

  for (const operation of operations) {
    if (!actions.has(operation.action)) {
      continue;
    }
    const normalizedCounterparty = operation.counterparty
      ?.trim()
      .toLocaleLowerCase("ru-RU");
    const key = `${operation.currency}\u0000${normalizedCounterparty ?? ""}`;
    const current = positions.get(key) ?? {
      counterparty: operation.counterparty,
      currency: operation.currency,
      amount: 0
    };
    const reducesDebt =
      operation.action === "repay_borrowed" || operation.action === "collect";
    current.amount += reducesDebt ? -operation.amount : operation.amount;
    positions.set(key, current);
  }

  return [...positions.values()]
    .map((position) => ({ ...position, amount: roundMoney(position.amount) }))
    .filter((position) => position.amount !== 0)
    .sort(
      (left, right) =>
        left.currency.localeCompare(right.currency) ||
        (left.counterparty ?? "").localeCompare(
          right.counterparty ?? "",
          "ru-RU"
        )
    );
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
