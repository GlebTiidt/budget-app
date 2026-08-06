export type ReportDirection = "income" | "expense" | "transfer";

export type MasterLedgerTransaction = {
  occurredOn: string;
  direction: ReportDirection;
  amount: number;
  category: string | null;
};

export type MasterReport = {
  month: string;
  currency: "EUR";
  income: number;
  expense: number;
  net: number;
  days: Array<{
    date: string;
    label: string;
    income: number;
    expense: number;
  }>;
  expenseCategories: Array<{
    category: string;
    amount: number;
  }>;
};

export function buildMasterReport(
  month: string,
  transactions: MasterLedgerTransaction[]
): MasterReport {
  validateMonth(month);
  const daysInMonth = getDaysInMonth(month);
  const dailyIncome = new Map<string, number>();
  const dailyExpense = new Map<string, number>();
  const expenseCategories = new Map<string, number>();

  for (const transaction of transactions) {
    if (!transaction.occurredOn.startsWith(`${month}-`)) {
      continue;
    }
    if (!Number.isFinite(transaction.amount) || transaction.amount < 0) {
      throw new Error("Report transaction amount must be non-negative.");
    }
    if (transaction.direction === "transfer") {
      continue;
    }

    const target =
      transaction.direction === "income" ? dailyIncome : dailyExpense;
    target.set(
      transaction.occurredOn,
      (target.get(transaction.occurredOn) ?? 0) + transaction.amount
    );

    if (transaction.direction === "expense" && transaction.amount > 0) {
      const category = transaction.category?.trim() || "Без категории";
      expenseCategories.set(
        category,
        (expenseCategories.get(category) ?? 0) + transaction.amount
      );
    }
  }

  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    const date = `${month}-${day}`;
    return {
      date,
      label: day,
      income: roundMoney(dailyIncome.get(date) ?? 0),
      expense: roundMoney(dailyExpense.get(date) ?? 0)
    };
  });
  const income = roundMoney(
    days.reduce((sum, day) => sum + day.income, 0)
  );
  const expense = roundMoney(
    days.reduce((sum, day) => sum + day.expense, 0)
  );

  return {
    month,
    currency: "EUR",
    income,
    expense,
    net: roundMoney(income - expense),
    days,
    expenseCategories: [...expenseCategories.entries()]
      .map(([category, amount]) => ({
        category,
        amount: roundMoney(amount)
      }))
      .sort((left, right) => right.amount - left.amount)
  };
}

export function validateMonth(value: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error("Month must use YYYY-MM.");
  }
}

function getDaysInMonth(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
