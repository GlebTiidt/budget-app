export type TransactionDirection = "expense" | "income" | "transfer";

export type MoneyAmount = {
  value: number;
  currency: string;
};

export type BudgetTransaction = {
  id?: string;
  amount: MoneyAmount;
  direction: TransactionDirection;
  category?: string;
  account?: string;
  occurredAt: Date;
  source: TransactionSource;
  rawInput?: string;
  note?: string;
};

export type TransactionSource = {
  kind: "telegram" | "manual" | "import";
  externalId?: string;
};
