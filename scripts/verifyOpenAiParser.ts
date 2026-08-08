import { ACCOUNTS, CURRENCIES, TRANSACTION_CATEGORIES } from "../src/budget/catalog.js";
import { loadConfig } from "../src/config/loadConfig.js";
import {
  createOpenAiTransactionParser,
  type ParsedBudgetMessageDraft,
  type ParsedDebtOperationDraft,
  type ParsedTransactionDraft
} from "../src/integrations/openai/openAiTransactionParser.js";
import type {
  OpenAiReasoningEffort,
  OpenAiTokenUsage
} from "../src/integrations/openai/openAiTokenOptimization.js";
import { formatBudgetMessagePreview } from "../src/integrations/telegram/telegramBot.js";

type DirectionCounts = {
  expense: number;
  income: number;
  transfer: number;
};

type ExpectedTransaction = Partial<
  Pick<
    ParsedTransactionDraft,
    | "amount"
    | "currency"
    | "direction"
    | "category"
    | "account"
    | "destinationAccount"
  >
>;

type ExpectedDebtOperation = Partial<
  Pick<
    ParsedDebtOperationDraft,
    "amount" | "currency" | "action" | "counterparty" | "account"
  >
>;

type VerificationCase = {
  name: string;
  input: string;
  expectedDirections: DirectionCounts;
  expectedBalanceObservations: number;
  expectedTransactions?: ExpectedTransaction[];
  expectedDebtOperations?: ExpectedDebtOperation[];
};

const fixedNow = new Date("2026-08-04T07:45:00.000Z");
const reasoningEffort = readReasoningEffort(process.argv.slice(2));
const tokenUsage: OpenAiTokenUsage[] = [];

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
    name: "subscription expense from crypto wallet",
    input: "Оплатил подписку на сервис 20 USD с криптокошелька",
    expectedDirections: { income: 0, expense: 1, transfer: 0 },
    expectedBalanceObservations: 0,
    expectedTransactions: [
      {
        amount: 20,
        currency: "USD",
        direction: "expense",
        category: "Подписки",
        account: "Crypto"
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
    expectedTransactions: [
      {
        amount: 200,
        currency: "EUR",
        direction: "transfer",
        account: "Карта",
        destinationAccount: "Сбережения"
      }
    ]
  },
  {
    name: "borrowing, repayment, lending, and collection stay separate",
    input:
      "Сегодня взял у Пети в долг 350 USD на карту, вернул ему 50 USD с карты, дал Ане 2 000 000 VND в долг наличными, а Олег вернул мне 100 EUR долга на карту.",
    expectedDirections: { income: 0, expense: 0, transfer: 0 },
    expectedBalanceObservations: 0,
    expectedDebtOperations: [
      {
        amount: 350,
        currency: "USD",
        action: "borrow",
        counterparty: "Петя",
        account: "Карта"
      },
      {
        amount: 50,
        currency: "USD",
        action: "repay_borrowed",
        counterparty: "Петя",
        account: "Карта"
      },
      {
        amount: 2_000_000,
        currency: "VND",
        action: "lend",
        counterparty: "Аня",
        account: "Наличные"
      },
      {
        amount: 100,
        currency: "EUR",
        action: "collect",
        counterparty: "Олег",
        account: "Карта"
      }
    ]
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
  currencies: [...CURRENCIES],
  reasoningEffort,
  onTokenUsage: (usage) => tokenUsage.push(usage)
});

console.log(`Live parser reasoning effort: ${reasoningEffort}.`);

let passed = 0;
let revisionSource: ParsedBudgetMessageDraft | undefined;
let debtRevisionSource: ParsedBudgetMessageDraft | undefined;

for (const [index, verificationCase] of verificationCases.entries()) {
  const parsed = await parser.parse(verificationCase.input, fixedNow);
  if (index === 0) {
    revisionSource = parsed;
  }
  if ((verificationCase.expectedDebtOperations?.length ?? 0) > 0) {
    debtRevisionSource = parsed;
  }
  const errors = verifyResult(parsed, verificationCase);
  const counts = countDirections(parsed);
  const status = errors.length === 0 ? "PASS" : "FAIL";

  console.log(
    `${index + 1}. ${status} — ${verificationCase.name} — ` +
      `income=${counts.income}, expense=${counts.expense}, transfer=${counts.transfer}, ` +
      `debts=${parsed.debtOperations.length}, balances=${parsed.balanceObservations.length}`
  );

  for (const draft of parsed.transactions) {
    const accountRoute =
      draft.direction === "transfer"
        ? ` · ${draft.account ?? "?"} → ${draft.destinationAccount ?? "?"}`
        : ` · ${draft.account ?? "без счёта"}`;
    console.log(
      `   ${draft.direction}: ${draft.amount ?? "?"} ${draft.currency ?? "?"} · ` +
        `${draft.category ?? "без категории"} · ${draft.description}${accountRoute}`
    );
  }

  for (const debt of parsed.debtOperations) {
    console.log(
      `   debt:${debt.action}: ${debt.amount ?? "?"} ${debt.currency ?? "?"} · ` +
        `${debt.counterparty ?? "без контрагента"} · ${debt.account ?? "без счёта"}`
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

let revisionPassed = false;
let accountTransferRevisionPassed = false;
let debtRevisionPassed = false;
if (revisionSource) {
  const revised = await parser.revise(
    formatBudgetMessagePreview(revisionSource),
    [
      "1: сначала через внешний кошелёк, потом на Вьетнамский счёт",
      "2: Вьетнамский счёт",
      "3: тоже",
      "тоже",
      "тоже"
    ].join("\n"),
    fixedNow
  );
  revisionPassed =
    revised.transactions.length === 5 &&
    revised.transactions.every((item) => item.account === "Вьетнамский счёт");
  console.log(
    `Live reply revision: ${revisionPassed ? "PASS" : "FAIL"} — ` +
      `transactions=${revised.transactions.length}, ` +
      `balances=${revised.balanceObservations.length}`
  );

  const routed = await parser.revise(
    formatBudgetMessagePreview(revisionSource),
    [
      "1: Аванс изначально Crypto, потом перевод всей суммы на вьет счёт",
      "2: Вьет счёт",
      "тоже",
      "всё остальное тоже"
    ].join("\n"),
    fixedNow
  );
  const routedIncome = routed.transactions.find(
    (item) => item.direction === "income" && item.amount === 240
  );
  const routedTransfer = routed.transactions.find(
    (item) =>
      item.direction === "transfer" &&
      item.amount === 240 &&
      item.account === "Crypto" &&
      item.destinationAccount === "Вьетнамский счёт"
  );
  const routedExpenses = routed.transactions.filter(
    (item) => item.direction === "expense"
  );
  accountTransferRevisionPassed =
    routed.transactions.length === 6 &&
    routedIncome?.account === "Crypto" &&
    Boolean(routedTransfer) &&
    routedExpenses.length === 4 &&
    routedExpenses.every((item) => item.account === "Вьетнамский счёт");
  console.log(
    `Live account-transfer revision: ${accountTransferRevisionPassed ? "PASS" : "FAIL"} — ` +
      `transactions=${routed.transactions.length}, ` +
      `transfers=${routed.transactions.filter((item) => item.direction === "transfer").length}, ` +
      `balances=${routed.balanceObservations.length}`
  );
}

if (debtRevisionSource) {
  const revisedDebt = await parser.revise(
    formatBudgetMessagePreview(debtRevisionSource),
    "долг 1: счёт Сбережения",
    fixedNow
  );
  debtRevisionPassed =
    revisedDebt.transactions.length === 0 &&
    revisedDebt.debtOperations.length === 4 &&
    revisedDebt.debtOperations[0]?.action === "borrow" &&
    revisedDebt.debtOperations[0]?.account === "Сбережения" &&
    revisedDebt.debtOperations[1]?.account === "Карта" &&
    revisedDebt.debtOperations[2]?.account === "Наличные" &&
    revisedDebt.debtOperations[3]?.account === "Карта";
  console.log(
    `Live debt-number revision: ${debtRevisionPassed ? "PASS" : "FAIL"} — ` +
      `transactions=${revisedDebt.transactions.length}, ` +
      `debts=${revisedDebt.debtOperations.length}`
  );
}

if (
  passed !== verificationCases.length ||
  !revisionPassed ||
  !accountTransferRevisionPassed ||
  !debtRevisionPassed
) {
  process.exitCode = 1;
}

printTokenUsageSummary(tokenUsage);

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

  for (const expected of verificationCase.expectedDebtOperations ?? []) {
    if (!parsed.debtOperations.some((actual) => debtOperationMatches(actual, expected))) {
      errors.push(`missing expected debt operation ${JSON.stringify(expected)}`);
    }
  }

  if (
    parsed.debtOperations.length !==
    (verificationCase.expectedDebtOperations?.length ?? 0)
  ) {
    errors.push(
      `expected debt operations=${verificationCase.expectedDebtOperations?.length ?? 0}, ` +
        `received ${parsed.debtOperations.length}`
    );
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

function debtOperationMatches(
  actual: ParsedDebtOperationDraft,
  expected: ExpectedDebtOperation
): boolean {
  return Object.entries(expected).every(([key, value]) => {
    return actual[key as keyof ExpectedDebtOperation] === value;
  });
}

function readReasoningEffort(args: string[]): OpenAiReasoningEffort {
  const value = args
    .find((argument) => argument.startsWith("--reasoning="))
    ?.slice("--reasoning=".length);

  if (value === undefined || value === "none") {
    return "none";
  }
  if (value === "low" || value === "medium") {
    return value;
  }

  throw new Error("Use --reasoning=none, --reasoning=low, or --reasoning=medium.");
}

function printTokenUsageSummary(usages: OpenAiTokenUsage[]): void {
  const totals = usages.reduce(
    (result, usage) => ({
      requests: result.requests + 1,
      inputTokens: result.inputTokens + usage.inputTokens,
      cachedInputTokens: result.cachedInputTokens + usage.cachedInputTokens,
      cacheWriteTokens: result.cacheWriteTokens + usage.cacheWriteTokens,
      outputTokens: result.outputTokens + usage.outputTokens,
      reasoningTokens: result.reasoningTokens + usage.reasoningTokens,
      totalTokens: result.totalTokens + usage.totalTokens
    }),
    {
      requests: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0
    }
  );
  const cacheReadPercent =
    totals.inputTokens === 0
      ? 0
      : (totals.cachedInputTokens / totals.inputTokens) * 100;

  console.log(
    "OpenAI usage summary: " +
      `requests=${totals.requests}, input=${totals.inputTokens}, ` +
      `cache-read=${totals.cachedInputTokens} (${cacheReadPercent.toFixed(1)}%), ` +
      `cache-write=${totals.cacheWriteTokens}, output=${totals.outputTokens}, ` +
      `reasoning=${totals.reasoningTokens}, total=${totals.totalTokens}.`
  );
}
