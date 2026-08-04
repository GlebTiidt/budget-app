import OpenAI from "openai";
import type { TransactionDirection } from "../../budget/types.js";

export type ParsedTransactionDraft = {
  amount: number | null;
  currency: string | null;
  direction: TransactionDirection;
  occurredOn: string;
  category: string | null;
  account: string | null;
  description: string;
  note: string | null;
  confidence: number;
  ambiguities: string[];
};

export type ParsedBalanceObservationDraft = {
  amount: number;
  currency: string;
  occurredOn: string;
  account: string | null;
  confidence: number;
  ambiguities: string[];
};

export type ParsedBudgetMessageDraft = {
  transactions: ParsedTransactionDraft[];
  balanceObservations: ParsedBalanceObservationDraft[];
  ambiguities: string[];
};

export type TransactionTextParser = {
  parse(input: string, now?: Date): Promise<ParsedBudgetMessageDraft>;
};

export type OpenAiTransactionParserOptions = {
  apiKey: string;
  model: string;
  timezone: string;
  categories?: string[];
  accounts?: string[];
  currencies?: string[];
};

const transactionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    amount: { type: ["number", "null"] },
    currency: { type: ["string", "null"] },
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

const balanceObservationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    amount: { type: "number", exclusiveMinimum: 0 },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    occurredOn: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    account: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    ambiguities: { type: "array", items: { type: "string" } }
  },
  required: [
    "amount",
    "currency",
    "occurredOn",
    "account",
    "confidence",
    "ambiguities"
  ]
} as const;

const budgetMessageSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    transactions: {
      type: "array",
      maxItems: 20,
      items: transactionSchema
    },
    balanceObservations: {
      type: "array",
      maxItems: 5,
      items: balanceObservationSchema
    },
    ambiguities: { type: "array", items: { type: "string" } }
  },
  required: ["transactions", "balanceObservations", "ambiguities"]
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
            name: "budget_message",
            strict: true,
            schema: budgetMessageSchema
          }
        }
      });

      if (!response.output_text) {
        throw new Error("OpenAI returned no budget data.");
      }

      return normalizeParsedBudgetMessage(JSON.parse(response.output_text));
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
  const currencyRule = options.currencies?.length
    ? `Supported currencies: ${options.currencies.join(", ")}. Set currency to null when the text does not identify one.`
    : "Use an ISO 4217 three-letter currency code, or null when the currency is not identified.";

  return [
    "Extract every distinct personal budget transaction from the current Telegram message, not only the first one.",
    "Read the entire message before finalizing items. Later clauses may explain the source, type, date, or purpose of an amount mentioned earlier.",
    "Resolve references such as эти деньги, денег я взял, это аванс, or можно учесть как зарплату to the nearest compatible amount already stated in the same message. Attach that amount to the clarified transaction instead of creating a duplicate incomplete item.",
    "Example: if the user had 240 USD, exchanged it to VND, and later says those funds were a salary advance, return one 240 USD income in category Работа; do not return the exchange or a second amount-less advance.",
    "Keep transactions in the same order in which the message mentions them.",
    "Create a separate transaction for every distinct received, earned, paid, bought, ordered, or spent amount.",
    "A salary advance or advance from the user's employer is income in category Работа.",
    "If a financial action is mentioned without its amount or currency, keep it as an incomplete transaction with null for the missing field and explain the omission in ambiguities. Never invent missing values.",
    "Do not split one amount between multiple purchases and do not derive an unmentioned amount from a remaining balance.",
    "A currency exchange of money the user already owns is not income or expense. Do not create a transaction for the exchange itself unless an explicit fee is stated.",
    "A statement of money currently remaining is a balance observation, not income or expense. Put it in balanceObservations and do not duplicate it in transactions.",
    "Instructions, intentions, and accounting comments without their own financial event are not transactions.",
    "Normalize each merchant or purpose into a short description; do not copy the whole message.",
    "Keep useful transaction details in note, including what was bought, fuel, bike rental, salary-advance, or currency-exchange context.",
    "Interpret k/к/тыс after an amount as one thousand when context supports it.",
    currencyRule,
    `Current timestamp: ${now.toISOString()}. User timezone: ${options.timezone}.`,
    "Resolve relative dates such as today, yesterday, or позавчера independently for each item using that timezone. Reuse the surrounding date context until the message changes it.",
    categoryRule,
    "Category rules: salary or regular employment income is Работа; freelance income is Фриланс; gym, fitness, and pickleball are Спорт; fuel and bike rental are Транспорт, while the specific purpose remains in description or note.",
    "Account rule: Vietnamese QR payments use Вьетнамский счёт; Наличные is only for physical cash.",
    accountRule,
    "List item-specific uncertainty on that item. Put uncertainty affecting the whole message in top-level ambiguities.",
    "Reduce confidence for incomplete or uncertain items. Do not silently discard a clearly mentioned financial event.",
    "The application will show every item separately for confirmation before any later conversion or saving."
  ].join("\n");
}

export function normalizeParsedBudgetMessage(value: unknown): ParsedBudgetMessageDraft {
  const message = requireRecord(value, "budget message");
  const transactions = requireArray(message.transactions, "transactions").map(
    normalizeTransactionDraft
  );
  const balanceObservations = requireArray(
    message.balanceObservations,
    "balanceObservations"
  ).map(normalizeBalanceObservationDraft);

  return {
    transactions,
    balanceObservations,
    ambiguities: normalizeStringArray(message.ambiguities, "ambiguities")
  };
}

function normalizeTransactionDraft(value: unknown, index: number): ParsedTransactionDraft {
  const draft = requireRecord(value, `transactions[${index}]`);
  const amount = normalizeNullablePositiveNumber(draft.amount, `transactions[${index}].amount`);
  const currency = normalizeNullableCurrency(draft.currency, `transactions[${index}].currency`);
  const direction = requireDirection(draft.direction, `transactions[${index}].direction`);
  const occurredOn = requireDate(draft.occurredOn, `transactions[${index}].occurredOn`);
  const description = requireString(
    draft.description,
    `transactions[${index}].description`
  ).trim();

  if (!description) {
    throw new Error(`OpenAI returned an empty transactions[${index}].description.`);
  }

  return {
    amount,
    currency,
    direction,
    occurredOn,
    category: normalizeNullableString(draft.category, `transactions[${index}].category`),
    account: normalizeNullableString(draft.account, `transactions[${index}].account`),
    description,
    note: normalizeNullableString(draft.note, `transactions[${index}].note`),
    confidence: normalizeConfidence(draft.confidence, `transactions[${index}].confidence`),
    ambiguities: normalizeStringArray(
      draft.ambiguities,
      `transactions[${index}].ambiguities`
    )
  };
}

function normalizeBalanceObservationDraft(
  value: unknown,
  index: number
): ParsedBalanceObservationDraft {
  const draft = requireRecord(value, `balanceObservations[${index}]`);
  const amount = normalizeNullablePositiveNumber(
    draft.amount,
    `balanceObservations[${index}].amount`
  );

  if (amount === null) {
    throw new Error(`OpenAI returned no balanceObservations[${index}].amount.`);
  }

  const currency = normalizeNullableCurrency(
    draft.currency,
    `balanceObservations[${index}].currency`
  );
  if (currency === null) {
    throw new Error(`OpenAI returned no balanceObservations[${index}].currency.`);
  }

  return {
    amount,
    currency,
    occurredOn: requireDate(
      draft.occurredOn,
      `balanceObservations[${index}].occurredOn`
    ),
    account: normalizeNullableString(
      draft.account,
      `balanceObservations[${index}].account`
    ),
    confidence: normalizeConfidence(
      draft.confidence,
      `balanceObservations[${index}].confidence`
    ),
    ambiguities: normalizeStringArray(
      draft.ambiguities,
      `balanceObservations[${index}].ambiguities`
    )
  };
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`OpenAI returned an invalid ${path}.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`OpenAI returned an invalid ${path} array.`);
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new Error(`OpenAI returned an invalid ${path}.`);
  }
  return value;
}

function normalizeNullableString(value: unknown, path: string): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = requireString(value, path).trim();
  return trimmed || null;
}

function normalizeStringArray(value: unknown, path: string): string[] {
  return requireArray(value, path)
    .map((item, index) => requireString(item, `${path}[${index}]`).trim())
    .filter(Boolean);
}

function normalizeNullablePositiveNumber(value: unknown, path: string): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`OpenAI returned an invalid ${path}.`);
  }
  return value;
}

function normalizeNullableCurrency(value: unknown, path: string): string | null {
  if (value === null) {
    return null;
  }
  const currency = requireString(value, path).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error(`OpenAI returned an invalid ${path}.`);
  }
  return currency;
}

function requireDirection(value: unknown, path: string): TransactionDirection {
  if (value !== "expense" && value !== "income" && value !== "transfer") {
    throw new Error(`OpenAI returned an invalid ${path}.`);
  }
  return value;
}

function requireDate(value: unknown, path: string): string {
  const date = requireString(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`OpenAI returned an invalid ${path}.`);
  }
  return date;
}

function normalizeConfidence(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`OpenAI returned an invalid ${path}.`);
  }
  return Math.max(0, Math.min(1, value));
}
