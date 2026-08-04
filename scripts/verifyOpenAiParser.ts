import { ACCOUNTS, CURRENCIES, TRANSACTION_CATEGORIES } from "../src/budget/catalog.js";
import { loadConfig } from "../src/config/loadConfig.js";
import {
  createOpenAiTransactionParser,
  type ParsedBudgetMessageDraft,
  type ParsedTransactionDraft
} from "../src/integrations/openai/openAiTransactionParser.js";

type DirectionCounts = {
  expense: number;
  income: number;
  transfer: number;
};

type ExpectedTransaction = Partial<
  Pick<ParsedTransactionDraft, "amount" | "currency" | "direction" | "category" | "account">
>;

type VerificationCase = {
  name: string;
  input: string;
  expectedDirections: DirectionCounts;
  expectedBalanceObservations: number;
  expectedTransactions?: ExpectedTransaction[];
};

const fixedNow = new Date("2026-08-04T07:45:00.000Z");

const verificationCases: VerificationCase[] = [
  {
    name: "complex message: advance, four expenses, current balance",
    input:
      "Вчера у меня было 240 USD, которые я обменял на донги. Сегодня осталось 30к донгов. Оплатил поездку за 1800000 донгов, визу за 25 USD, купил билет за 420к донгов и оплатил рабочий сервис за 9 USD. Эти 240 USD я получил как аванс от работодателя.",
    expectedDirections: { income: 1, expense: 4, transfer: 0 },
    expectedBalanceObservations: 1,
    expectedTransactions: [
      { amount: 240, currency: "USD", direction: "income", category: "Работа" },
      { amount: 1_800_000, currency: "VND", direction: "expense" },
      { amount: 25, currency: "USD", direction: "expense" },
      { amount: 420_000, currency: "VND", direction: "expense" },
      { amount: 9, currency: "USD", direction: "expense" }
    ]
  },
  {
    name: "incomplete advance and fuel",
    input:
      "Отдельно: это аванс от работодателя, сумму не помню. Ещё сегодня заправился на 60к донгов.",
    expectedDirections: { income: 1, expense: 1, transfer: 0 },
    expectedBalanceObservations: 0,
    expectedTransactions: [
      { amount: null, currency: null, direction: "income", category: "Работа" },
      { amount: 60_000, currency: "VND", direction: "expense", category: "Транспорт" }
    ]
  },
  {
    name: "single coffee expense with QR account",
    input: "Сегодня заплатил 120к донгов за кофе по QR",
    expectedDirections: { income: 0, expense: 1, transfer: 0 },
    expectedBalanceObservations: 0,
    expectedTransactions: [
      {
        amount: 120_000,
        currency: "VND",
        direction: "expense",
        category: "Кофешоп",
        account: "Вьетнамский счёт"
      }
    ]
  },
  {
    name: "fuel slang with relative date",
    input: "Вчера бензин 100к донгов, платил по QR",
    expectedDirections: { income: 0, expense: 1, transfer: 0 },
    expectedBalanceObservations: 0,
    expectedTransactions: [
      {
        amount: 100_000,
        currency: "VND",
        direction: "expense",
        category: "Транспорт",
        account: "Вьетнамский счёт"
      }
    ]
  },
  {
    name: "freelance income",
    input: "Получил 500 USD за фриланс",
    expectedDirections: { income: 1, expense: 0, transfer: 0 },
    expectedBalanceObservations: 0,
    expectedTransactions: [
      { amount: 500, currency: "USD", direction: "income", category: "Фриланс" }
    ]
  },
  {
    name: "incomplete expense keeps missing currency",
    input: "Потратил 50",
    expectedDirections: { income: 0, expense: 1, transfer: 0 },
    expectedBalanceObservations: 0,
    expectedTransactions: [
      { amount: 50, currency: null, direction: "expense" }
    ]
  },
  {
    name: "mixed income and expense",
    input: "Сегодня получил 500 USD за фриланс, потом заплатил 120к донгов за кофе по QR",
    expectedDirections: { income: 1, expense: 1, transfer: 0 },
    expectedBalanceObservations: 0,
    expectedTransactions: [
      { amount: 500, currency: "USD", direction: "income", category: "Фриланс" },
      { amount: 120_000, currency: "VND", direction: "expense", category: "Кофешоп" }
    ]
  },
  {
    name: "three expenses sharing one date",
    input:
      "Вчера купил продукты за 430к VND, заплатил 80к за такси и 150к донгов за ужин вне дома",
    expectedDirections: { income: 0, expense: 3, transfer: 0 },
    expectedBalanceObservations: 0,
    expectedTransactions: [
      { amount: 430_000, currency: "VND", direction: "expense", category: "Еда" },
      { amount: 80_000, currency: "VND", direction: "expense", category: "Транспорт" },
      { amount: 150_000, currency: "VND", direction: "expense", category: "Еда вне дома" }
    ]
  },
  {
    name: "balance observation is not a transaction",
    input: "Сегодня на вьетнамском счёте осталось 2 300 000 донгов",
    expectedDirections: { income: 0, expense: 0, transfer: 0 },
    expectedBalanceObservations: 1
  },
  {
    name: "personal account transfer",
    input: "Сегодня перевёл 200 EUR с карты в сбережения",
    expectedDirections: { income: 0, expense: 0, transfer: 1 },
    expectedBalanceObservations: 0,
    expectedTransactions: [{ amount: 200, currency: "EUR", direction: "transfer" }]
  }
];

const config = loadConfig();
if (!config.openaiApiKey) {
  throw new Error("OPENAI_API_KEY is not configured in .env.local.");
}

const parser = createOpenAiTransactionParser({
  apiKey: config.openaiApiKey,
  model: config.openaiModel,
  timezone: config.timezone,
  categories: [...TRANSACTION_CATEGORIES],
  accounts: [...ACCOUNTS],
  currencies: [...CURRENCIES]
});

let passed = 0;

for (const [index, verificationCase] of verificationCases.entries()) {
  const parsed = await parser.parse(verificationCase.input, fixedNow);
  const errors = verifyResult(parsed, verificationCase);
  const counts = countDirections(parsed);
  const status = errors.length === 0 ? "PASS" : "FAIL";

  console.log(
    `${index + 1}. ${status} — ${verificationCase.name} — ` +
      `income=${counts.income}, expense=${counts.expense}, transfer=${counts.transfer}, ` +
      `balances=${parsed.balanceObservations.length}`
  );

  for (const draft of parsed.transactions) {
    console.log(
      `   ${draft.direction}: ${draft.amount ?? "?"} ${draft.currency ?? "?"} · ` +
        `${draft.category ?? "без категории"} · ${draft.description}`
    );
  }

  for (const error of errors) {
    console.error(`   ${error}`);
  }

  if (errors.length === 0) {
    passed += 1;
  }
}

console.log(`Live parser verification: ${passed}/${verificationCases.length} passed.`);

if (passed !== verificationCases.length) {
  process.exitCode = 1;
}

function verifyResult(
  parsed: ParsedBudgetMessageDraft,
  verificationCase: VerificationCase
): string[] {
  const errors: string[] = [];
  const actualDirections = countDirections(parsed);

  for (const direction of ["income", "expense", "transfer"] as const) {
    if (actualDirections[direction] !== verificationCase.expectedDirections[direction]) {
      errors.push(
        `expected ${direction}=${verificationCase.expectedDirections[direction]}, ` +
          `received ${actualDirections[direction]}`
      );
    }
  }

  if (parsed.balanceObservations.length !== verificationCase.expectedBalanceObservations) {
    errors.push(
      `expected balances=${verificationCase.expectedBalanceObservations}, ` +
        `received ${parsed.balanceObservations.length}`
    );
  }

  for (const expected of verificationCase.expectedTransactions ?? []) {
    if (!parsed.transactions.some((actual) => transactionMatches(actual, expected))) {
      errors.push(`missing expected transaction ${JSON.stringify(expected)}`);
    }
  }

  return errors;
}

function countDirections(parsed: ParsedBudgetMessageDraft): DirectionCounts {
  return parsed.transactions.reduce<DirectionCounts>(
    (counts, transaction) => {
      counts[transaction.direction] += 1;
      return counts;
    },
    { income: 0, expense: 0, transfer: 0 }
  );
}

function transactionMatches(
  actual: ParsedTransactionDraft,
  expected: ExpectedTransaction
): boolean {
  return Object.entries(expected).every(([key, value]) => {
    return actual[key as keyof ExpectedTransaction] === value;
  });
}
