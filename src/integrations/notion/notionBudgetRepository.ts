import type { BudgetTransaction } from "../../budget/types.js";

export type NotionBudgetRepository = {
  saveTransaction(transaction: BudgetTransaction): Promise<string>;
};

export function createNotionBudgetRepository(): NotionBudgetRepository {
  return {
    async saveTransaction() {
      // TODO: Map BudgetTransaction to Notion database properties.
      throw new Error("Notion repository is not implemented yet.");
    }
  };
}
