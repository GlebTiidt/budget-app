import OpenAI from "openai";
import type { TransactionDirection } from "../../budget/types.js";

export type ParsedTransactionDraft = {
  amount: number;
  currency: string;
  direction: TransactionDirection;
  occurredOn: string;
  category: string | null;
  account: string | null;
  description: string;
  note: string | null;
  confidence: number;
  ambiguities: string[];
};

export type TransactionTextParser = {
  parse(input: string, now?: Date): Promise<ParsedTransactionDraft>;
};

export type OpenAiTransactionParserOptions = {
  apiKey: string;
  model: string;
  timezone: string;
  categories?: string[];
  accounts?: string[];
};

const transactionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    amount: { type: "number", exclusiveMinimum: 0 },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    direction: { type: "string", enum: ["expense", "income", "transfer"] },
    occurredOn: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    category: { type: ["string", "null"] },
    account: { type: ["string", "null"] },
    description: { type: "string", minLength: 1 },
    note: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    ambiguities: { type: "array", items: { type: "string" } }
  },
  required: [
    "amount",
    "currency",
    "direction",
    "occurredOn",
    "category",
    "account",
    "description",
    "note",
    "confidence",
    "ambiguities"
  ]
} as const;

export function createOpenAiTransactionParser(
  options: OpenAiTransactionParserOptions
): TransactionTextParser {
  const client = new OpenAI({ apiKey: options.apiKey });

  return {
    async parse(input, now = new Date()) {
      const trimmed = input.trim();
      if (!trimmed) {
        throw new Error("Transaction text is empty.");
      }

      const response = await client.responses.create({
        model: options.model,
        instructions: buildInstructions(options, now),
        input: trimmed,
        text: {
          format: {
            type: "json_schema",
            name: "budget_transaction",
            strict: true,
            schema: transactionSchema
          }
        }
      });

      if (!response.output_text) {
        throw new Error("OpenAI returned no transaction data.");
      }

      return normalizeDraft(JSON.parse(response.output_text) as ParsedTransactionDraft);
    }
  };
}

function buildInstructions(options: OpenAiTransactionParserOptions, now: Date): string {
  const categoryRule = options.categories?.length
    ? `Use a category from this list when possible: ${options.categories.join(", ")}.`
    : "Choose a short, reusable category name in the language of the input.";
  const accountRule = options.accounts?.length
    ? `Use an account from this list when it is stated or strongly implied: ${options.accounts.join(", ")}.`
    : "Set account to null unless it is stated.";

  return [
    "Extract exactly one personal budget transaction from informal Telegram text.",
    "Normalize the merchant or purpose into a short description; do not copy the whole message.",
    "Do not invent an amount, currency, date, account, or category.",
    "Interpret k/к/тыс after an amount as one thousand when context supports it.",
    "Use ISO 4217 three-letter currency codes.",
    `Current timestamp: ${now.toISOString()}. User timezone: ${options.timezone}.`,
    "Resolve relative dates such as today, yesterday, or позавчера using that timezone.",
    categoryRule,
    accountRule,
    "List every material uncertainty in ambiguities and reduce confidence accordingly.",
    "The application will ask the user to confirm before saving."
  ].join("\n");
}

function normalizeDraft(draft: ParsedTransactionDraft): ParsedTransactionDraft {
  if (!Number.isFinite(draft.amount) || draft.amount <= 0) {
    throw new Error("OpenAI returned an invalid amount.");
  }

  const currency = draft.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("OpenAI returned an invalid currency code.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.occurredOn)) {
    throw new Error("OpenAI returned an invalid transaction date.");
  }

  return {
    ...draft,
    currency,
    description: draft.description.trim(),
    category: cleanOptional(draft.category),
    account: cleanOptional(draft.account),
    note: cleanOptional(draft.note),
    confidence: Math.max(0, Math.min(1, draft.confidence)),
    ambiguities: draft.ambiguities.map((item) => item.trim()).filter(Boolean)
  };
}

function cleanOptional(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
