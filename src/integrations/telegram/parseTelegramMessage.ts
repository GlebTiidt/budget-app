import type { BudgetTransaction } from "../../budget/types.js";

export type ParseTelegramMessageResult =
  | { ok: true; transaction: BudgetTransaction }
  | { ok: false; reason: string };

export function parseTelegramMessage(input: string, messageId: string): ParseTelegramMessageResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { ok: false, reason: "Message is empty." };
  }

  // TODO: Replace with the real personal input grammar.
  return {
    ok: false,
    reason: `Parser is not implemented yet for message ${messageId}.`
  };
}
