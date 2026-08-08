import type { SupportedCurrency } from "../budget/userSettings.js";
import type { CurrencyConverter } from "../integrations/currency/frankfurterCurrencyConverter.js";
import type { MasterBalanceRepository } from "../integrations/notion/notionMasterBalanceRepository.js";
import type { MasterDebtRepository } from "../integrations/notion/notionMasterDebtRepository.js";
import type {
  MasterLedgerRepository,
  MasterRunningBalanceRow
} from "../integrations/notion/notionMasterLedgerRepository.js";
import type { MasterOpeningBalanceRepository } from "../integrations/notion/notionMasterOpeningBalanceRepository.js";
import type { ParsedBudgetMessageDraft } from "../integrations/openai/openAiTransactionParser.js";

export type MasterBudgetSaveInput = {
  telegramUserId: string;
  chatId: string;
  sourceMessageId: number;
  baseCurrency: SupportedCurrency;
  parsed: ParsedBudgetMessageDraft;
  acceptBalanceMismatch?: boolean;
};

export type MasterBudgetSaveResult =
  | {
      status: "saved";
      openingBalanceCreated: boolean;
      transactionCount: number;
      debtOperationCount: number;
      balanceObservationCount: number;
      historicalOperationCount: number;
      currentBalance: number;
      baseCurrency: SupportedCurrency;
    }
  | {
      status: "balance_mismatch";
      observedBalance: number;
      calculatedBalance: number;
      difference: number;
      tolerance: number;
      baseCurrency: SupportedCurrency;
    };

type Options = {
  currencyConverter: CurrencyConverter;
  ledgerRepository: MasterLedgerRepository;
  debtRepository: MasterDebtRepository;
  balanceRepository: MasterBalanceRepository;
  openingBalanceRepository: MasterOpeningBalanceRepository;
};

type ConvertedOperation = {
  kind: "transaction" | "debt";
  originalIndex: number;
  occurredOn: string;
  originalAmount: number;
  originalCurrency: string;
  conversionRate: number;
  baseAmount: number;
};

type ConvertedObservation = {
  originalIndex: number;
  occurredOn: string;
  originalAmount: number;
  originalCurrency: string;
  account: string | null;
  conversionRate: number;
  baseAmount: number;
};

const RECONCILIATION_FLOORS: Record<SupportedCurrency, number> = {
  USD: 5,
  EUR: 5,
  AUD: 5,
  RUB: 500,
  VND: 125_000
};

export function createMasterBudgetSaveService(options: Options) {
  return {
    async previewCurrentBalance(
      input: MasterBudgetSaveInput
    ): Promise<number | null> {
      validateIdentity(input);
      const opening = await options.openingBalanceRepository.find();
      if (!opening || opening.currency !== input.baseCurrency) return null;
      const anchor = await options.balanceRepository.findLatestAccepted();
      if (!anchor || anchor.baseCurrency !== input.baseCurrency) return null;
      const latest = latestRow(
        await options.ledgerRepository.findLatestRunningBalanceAfter(anchor.order),
        await options.debtRepository.findLatestRunningBalanceAfter(anchor.order)
      );
      let balance = latest?.runningBalance ?? anchor.balance;
      const completeParsed: ParsedBudgetMessageDraft = {
        ...input.parsed,
        transactions: input.parsed.transactions.filter(
          (item) => item.amount !== null && item.currency !== null
        ),
        debtOperations: input.parsed.debtOperations.filter(
          (item) => item.amount !== null && item.currency !== null
        )
      };
      const ordered = orderOperations(completeParsed);
      for (const operation of ordered) {
        if (operation.occurredOn < anchor.occurredOn) continue;
        if (latest && operation.occurredOn < latest.occurredOn) return null;
        const conversion = await options.currencyConverter.convert({
          amount: operation.originalAmount,
          from: operation.originalCurrency,
          to: input.baseCurrency,
          occurredOn: operation.occurredOn
        });
        balance = roundMoney(
          balance +
            balanceEffect(
              { ...operation, baseAmount: conversion.convertedAmount },
              completeParsed
            )
        );
      }
      return balance;
    },

    async save(input: MasterBudgetSaveInput): Promise<MasterBudgetSaveResult> {
      validateIdentity(input);
      validateCompleteDraft(input.parsed);
      const opening = await options.openingBalanceRepository.find();
      if (!opening) return initializeOpeningBalance(options, input);
      if (opening.currency !== input.baseCurrency) {
        throw new Error(
          `Основная валюта ${input.baseCurrency} не совпадает с валютой стартового остатка ${opening.currency}.`
        );
      }

      const anchor = await options.balanceRepository.findLatestAccepted();
      if (!anchor) {
        throw new Error(
          "Стартовый остаток настроен не полностью. Нужна проверка базы Notion."
        );
      }
      if (anchor.baseCurrency !== input.baseCurrency) {
        throw new Error("Валюта последнего остатка не совпадает с основной валютой.");
      }
      if (
        input.parsed.balanceObservations.length > 0 &&
        anchor.sourceId ===
          sourceId(input, "balance", input.parsed.balanceObservations.length)
      ) {
        return {
          status: "saved",
          openingBalanceCreated: false,
          transactionCount: input.parsed.transactions.length,
          debtOperationCount: input.parsed.debtOperations.length,
          balanceObservationCount: input.parsed.balanceObservations.length,
          historicalOperationCount: [
            ...input.parsed.transactions,
            ...input.parsed.debtOperations
          ].filter((item) => item.occurredOn < anchor.occurredOn).length,
          currentBalance: anchor.balance,
          baseCurrency: input.baseCurrency
        };
      }

      const ordered = orderOperations(input.parsed);
      const converted = await Promise.all(
        ordered.map(async (operation) => {
          const conversion = await options.currencyConverter.convert({
            amount: operation.originalAmount,
            from: operation.originalCurrency,
            to: input.baseCurrency,
            occurredOn: operation.occurredOn
          });
          return {
            ...operation,
            conversionRate: conversion.rate,
            baseAmount: conversion.convertedAmount
          };
        })
      );

      const baseOrder = messageBaseOrder(input.sourceMessageId);
      const latestBefore = latestRow(
        await options.ledgerRepository.findLatestRunningBalanceBetween(
          anchor.order,
          baseOrder
        ),
        await options.debtRepository.findLatestRunningBalanceBetween(
          anchor.order,
          baseOrder
        )
      );
      const latestOverall = latestRow(
        await options.ledgerRepository.findLatestRunningBalanceAfter(anchor.order),
        await options.debtRepository.findLatestRunningBalanceAfter(anchor.order)
      );
      const batchEnd =
        baseOrder +
        converted.length +
        input.parsed.balanceObservations.length +
        1;
      if (latestOverall && latestOverall.order >= batchEnd) {
        throw new Error(
          "Этот черновик старше уже сохранённых операций. Сначала нужна перерасчётка более поздних остатков."
        );
      }
      const active = converted.filter(
        (operation) => operation.occurredOn >= anchor.occurredOn
      );
      if (
        latestBefore &&
        active.some(
          (operation) => operation.occurredOn < latestBefore.occurredOn
        )
      ) {
        throw new Error(
          "Операция попадает внутрь уже рассчитанной истории после якоря. Сначала нужна перерасчётка последующих остатков."
        );
      }

      let runningBalance = latestBefore?.runningBalance ?? anchor.balance;
      const prepared = converted.map((operation, index) => {
        const historical = operation.occurredOn < anchor.occurredOn;
        if (!historical) {
          runningBalance = roundMoney(
            runningBalance + balanceEffect(operation, input.parsed)
          );
        }
        return {
          ...operation,
          order: baseOrder + index + 1,
          runningBalance: historical ? null : runningBalance,
          historical
        };
      });

      const observations = await convertObservations(options, input);
      let observationData: null | {
        total: number;
        difference: number;
        tolerance: number;
        status: "Совпадает" | "Принято пользователем";
      } = null;
      if (observations.length > 0) {
        const observationDate = observations[0]!.occurredOn;
        const latestActiveDate = active.at(-1)?.occurredOn ?? anchor.occurredOn;
        if (observationDate < latestActiveDate) {
          throw new Error(
            "Дата общего остатка должна быть не раньше последней операции после якоря."
          );
        }
        const total = roundMoney(
          observations.reduce((sum, observation) => sum + observation.baseAmount, 0)
        );
        const difference = roundMoney(total - runningBalance);
        const tolerance = reconciliationTolerance(
          runningBalance,
          input.baseCurrency
        );
        if (Math.abs(difference) > tolerance && !input.acceptBalanceMismatch) {
          return {
            status: "balance_mismatch",
            observedBalance: total,
            calculatedBalance: runningBalance,
            difference,
            tolerance,
            baseCurrency: input.baseCurrency
          };
        }
        observationData = {
          total,
          difference,
          tolerance,
          status:
            Math.abs(difference) <= tolerance
              ? "Совпадает"
              : "Принято пользователем"
        };
      }

      for (const item of prepared) {
        if (item.kind === "transaction") {
          const transaction = input.parsed.transactions[item.originalIndex]!;
          await options.ledgerRepository.saveTransaction({
            sourceId: sourceId(input, "transaction", item.originalIndex + 1),
            telegramUserId: input.telegramUserId,
            order: item.order,
            description: transaction.description,
            occurredOn: transaction.occurredOn,
            direction: transaction.direction,
            originalAmount: transaction.amount!,
            originalCurrency: transaction.currency!,
            conversionRate: item.conversionRate,
            baseAmount: item.baseAmount,
            baseCurrency: input.baseCurrency,
            category: transaction.category,
            account: transaction.account!,
            destinationAccount: transaction.destinationAccount,
            comment: transaction.note,
            runningBalance: item.runningBalance
          });
        } else {
          const debt = input.parsed.debtOperations[item.originalIndex]!;
          await options.debtRepository.saveDebtOperation({
            sourceId: sourceId(input, "debt", item.originalIndex + 1),
            telegramUserId: input.telegramUserId,
            order: item.order,
            description: debt.description,
            occurredOn: debt.occurredOn,
            action: debt.action,
            counterparty: debt.counterparty!,
            originalAmount: debt.amount!,
            originalCurrency: debt.currency!,
            conversionRate: item.conversionRate,
            baseAmount: item.baseAmount,
            baseCurrency: input.baseCurrency,
            account: debt.account!,
            comment: debt.note,
            runningBalance: item.runningBalance
          });
        }
      }

      if (observationData) {
        for (const observation of observations) {
          await options.balanceRepository.saveObservation({
            sourceId: sourceId(input, "balance", observation.originalIndex + 1),
            telegramUserId: input.telegramUserId,
            order: baseOrder + converted.length + observation.originalIndex + 1,
            occurredOn: observation.occurredOn,
            originalAmount: observation.originalAmount,
            originalCurrency: observation.originalCurrency,
            conversionRate: observation.conversionRate,
            baseAmount: observation.baseAmount,
            baseCurrency: input.baseCurrency,
            account: observation.account,
            calculatedBalance: runningBalance,
            acceptedBalance: observationData.total,
            isAnchor: observation.originalIndex === observations.length - 1,
            difference: observationData.difference,
            tolerance: observationData.tolerance,
            status: observationData.status,
            comment:
              observationData.status === "Принято пользователем"
                ? "Расхождение подтверждено пользователем"
                : null
          });
        }
        runningBalance = observationData.total;
      }

      return {
        status: "saved",
        openingBalanceCreated: false,
        transactionCount: input.parsed.transactions.length,
        debtOperationCount: input.parsed.debtOperations.length,
        balanceObservationCount: input.parsed.balanceObservations.length,
        historicalOperationCount: prepared.filter((item) => item.historical)
          .length,
        currentBalance: runningBalance,
        baseCurrency: input.baseCurrency
      };
    }
  };
}

async function initializeOpeningBalance(
  options: Options,
  input: MasterBudgetSaveInput
): Promise<MasterBudgetSaveResult> {
  if (
    input.parsed.transactions.length ||
    input.parsed.debtOperations.length ||
    input.parsed.balanceObservations.length === 0
  ) {
    throw new Error(
      "Сначала пришлите только точные остатки по кошелькам на одну дату — их сумма станет стартовым якорем."
    );
  }
  const observations = await convertObservations(options, input);
  const total = roundMoney(
    observations.reduce((sum, observation) => sum + observation.baseAmount, 0)
  );
  const tolerance = reconciliationTolerance(total, input.baseCurrency);
  const baseOrder = messageBaseOrder(input.sourceMessageId);
  for (const observation of observations) {
    await options.balanceRepository.saveObservation({
      sourceId: sourceId(input, "balance", observation.originalIndex + 1),
      telegramUserId: input.telegramUserId,
      order: baseOrder + observation.originalIndex + 1,
      occurredOn: observation.occurredOn,
      originalAmount: observation.originalAmount,
      originalCurrency: observation.originalCurrency,
      conversionRate: observation.conversionRate,
      baseAmount: observation.baseAmount,
      baseCurrency: input.baseCurrency,
      account: observation.account,
      calculatedBalance: total,
      acceptedBalance: total,
      isAnchor: observation.originalIndex === observations.length - 1,
      difference: 0,
      tolerance,
      status: "Принято пользователем",
      comment: "Стартовый остаток"
    });
  }
  await options.openingBalanceRepository.initialize({
    amount: total,
    currency: input.baseCurrency,
    effectiveOn: observations[0]!.occurredOn
  });
  return {
    status: "saved",
    openingBalanceCreated: true,
    transactionCount: 0,
    debtOperationCount: 0,
    balanceObservationCount: observations.length,
    historicalOperationCount: 0,
    currentBalance: total,
    baseCurrency: input.baseCurrency
  };
}

async function convertObservations(
  options: Options,
  input: MasterBudgetSaveInput
): Promise<ConvertedObservation[]> {
  return Promise.all(
    input.parsed.balanceObservations.map(async (observation, originalIndex) => {
      const conversion = await options.currencyConverter.convert({
        amount: observation.amount,
        from: observation.currency,
        to: input.baseCurrency,
        occurredOn: observation.occurredOn
      });
      return {
        originalIndex,
        occurredOn: observation.occurredOn,
        originalAmount: observation.amount,
        originalCurrency: observation.currency,
        account: observation.account,
        conversionRate: conversion.rate,
        baseAmount: conversion.convertedAmount
      };
    })
  );
}

function orderOperations(parsed: ParsedBudgetMessageDraft): ConvertedOperation[] {
  const items: ConvertedOperation[] = [
    ...parsed.transactions.map((item, originalIndex) => ({
      kind: "transaction" as const,
      originalIndex,
      occurredOn: item.occurredOn,
      originalAmount: item.amount!,
      originalCurrency: item.currency!,
      conversionRate: 0,
      baseAmount: 0
    })),
    ...parsed.debtOperations.map((item, originalIndex) => ({
      kind: "debt" as const,
      originalIndex,
      occurredOn: item.occurredOn,
      originalAmount: item.amount!,
      originalCurrency: item.currency!,
      conversionRate: 0,
      baseAmount: 0
    }))
  ];
  return items.sort(
    (a, b) =>
      a.occurredOn.localeCompare(b.occurredOn) ||
      kindOrder(a.kind) - kindOrder(b.kind) ||
      a.originalIndex - b.originalIndex
  );
}

function balanceEffect(
  operation: ConvertedOperation,
  parsed: ParsedBudgetMessageDraft
) {
  if (operation.kind === "transaction") {
    const direction = parsed.transactions[operation.originalIndex]!.direction;
    return direction === "income"
      ? operation.baseAmount
      : direction === "expense"
        ? -operation.baseAmount
        : 0;
  }
  const action = parsed.debtOperations[operation.originalIndex]!.action;
  return action === "borrow" || action === "collect"
    ? operation.baseAmount
    : -operation.baseAmount;
}

function validateCompleteDraft(parsed: ParsedBudgetMessageDraft) {
  if (
    !parsed.transactions.length &&
    !parsed.debtOperations.length &&
    !parsed.balanceObservations.length
  ) {
    throw new Error("В черновике нет финансовых данных для записи.");
  }
  if (parsed.ambiguities.length) {
    throw new Error("Сначала исправьте все уточнения в черновике.");
  }
  for (const transaction of parsed.transactions) {
    if (
      transaction.amount === null ||
      transaction.currency === null ||
      !transaction.account ||
      (transaction.direction !== "transfer" && !transaction.category) ||
      (transaction.direction === "transfer" &&
        !transaction.destinationAccount) ||
      transaction.ambiguities.length
    ) {
      throw new Error("Сначала заполните все поля операций в черновике.");
    }
  }
  for (const debt of parsed.debtOperations) {
    if (
      debt.amount === null ||
      debt.currency === null ||
      !debt.counterparty ||
      !debt.account ||
      debt.ambiguities.length
    ) {
      throw new Error("Сначала заполните все поля долговых операций в черновике.");
    }
  }
  const observationDates = new Set(
    parsed.balanceObservations.map((balance) => balance.occurredOn)
  );
  if (observationDates.size > 1) {
    throw new Error("Все остатки по кошелькам должны быть указаны на одну дату.");
  }
  const walletCurrencies = new Set<string>();
  for (const balance of parsed.balanceObservations) {
    if (balance.ambiguities.length) {
      throw new Error("Сначала уточните остатки по кошелькам.");
    }
    if (parsed.balanceObservations.length > 1 && !balance.account) {
      throw new Error("Для каждого из нескольких остатков укажите кошелёк.");
    }
    const key = `${balance.account ?? "total"}\u0000${balance.currency}`;
    if (walletCurrencies.has(key)) {
      throw new Error(
        "Один кошелёк с одной валютой указан несколько раз. Объедините суммы или уточните запись."
      );
    }
    walletCurrencies.add(key);
  }
}

function reconciliationTolerance(
  calculatedBalance: number,
  currency: SupportedCurrency
) {
  return roundMoney(
    Math.max(
      Math.abs(calculatedBalance) * 0.02,
      RECONCILIATION_FLOORS[currency]
    )
  );
}

function validateIdentity(input: MasterBudgetSaveInput) {
  if (
    !/^\d{1,20}$/.test(input.telegramUserId) ||
    !/^-?\d{1,20}$/.test(input.chatId)
  ) {
    throw new Error("Telegram identity is invalid.");
  }
  if (!Number.isSafeInteger(input.sourceMessageId) || input.sourceMessageId < 0) {
    throw new Error("Telegram source message ID is invalid.");
  }
}

function sourceId(
  input: MasterBudgetSaveInput,
  kind: string,
  index: number
) {
  return `${input.chatId}:${input.sourceMessageId}:${kind}:${index}`;
}

function messageBaseOrder(messageId: number) {
  const value = messageId * 100;
  if (!Number.isSafeInteger(value)) {
    throw new Error("Telegram message ID is too large for ordering.");
  }
  return value;
}

function latestRow(...rows: Array<MasterRunningBalanceRow | null>) {
  return (
    rows
      .filter((row): row is MasterRunningBalanceRow => row !== null)
      .sort((a, b) => b.order - a.order)[0] ?? null
  );
}

function kindOrder(kind: ConvertedOperation["kind"]) {
  return kind === "transaction" ? 0 : 1;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
