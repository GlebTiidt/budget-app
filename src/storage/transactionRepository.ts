import type { BudgetTransaction } from "../budget/types.js";

export type TransactionRepository = {
  saveTransaction(transaction: BudgetTransaction): Promise<string>;
};
