import type { BudgetTransaction } from "./types.js";

export type ValidationResult =
  | { ok: true; transaction: BudgetTransaction }
  | { ok: false; errors: string[] };

export function validateTransaction(transaction: BudgetTransaction): ValidationResult {
  const errors: string[] = [];

  if (!Number.isFinite(transaction.amount.value) || transaction.amount.value <= 0) {
    errors.push("Amount must be a positive number.");
  }

  if (!transaction.amount.currency.trim()) {
    errors.push("Currency is required.");
  }

  if (Number.isNaN(transaction.occurredAt.getTime())) {
    errors.push("Transaction date is invalid.");
  }

  if (!transaction.source.kind) {
    errors.push("Transaction source is required.");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, transaction };
}
