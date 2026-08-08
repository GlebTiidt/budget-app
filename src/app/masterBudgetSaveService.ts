import type { SupportedCurrency } from "../budget/userSettings.js";
import type { CurrencyConverter } from "../integrations/currency/frankfurterCurrencyConverter.js";
import type { MasterBalanceRepository } from "../integrations/notion/notionMasterBalanceRepository.js";
import type { MasterDebtRepository } from "../integrations/notion/notionMasterDebtRepository.js";
import type { MasterLedgerRepository, MasterRunningBalanceRow } from "../integrations/notion/notionMasterLedgerRepository.js";
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
      baseCurrency: "EUR";
    }
  | {
      status: "balance_mismatch";
      observedBalance: number;
      calculatedBalance: number;
      difference: number;
      tolerance: number;
      baseCurrency: "EUR";
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

export function createMasterBudgetSaveService(options: Options) {
  return {
    async previewCurrentBalance(
      input: MasterBudgetSaveInput
    ): Promise<number | null> {
      validateIdentity(input);
      if (input.baseCurrency !== "EUR") return null;
      const opening = await options.openingBalanceRepository.find();
      if (!opening) return null;
      const anchor = await options.balanceRepository.findLatestAccepted();
      if (!anchor) return null;
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
          to: "EUR",
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
      if (input.baseCurrency !== "EUR") {
        throw new Error("Реальная запись владельца пока доступна только с основной валютой EUR.");
      }
      validateCompleteDraft(input.parsed);
      const opening = await options.openingBalanceRepository.find();
      if (!opening) return initializeOpeningBalance(options, input);

      const anchor = await options.balanceRepository.findLatestAccepted();
      if (!anchor) throw new Error("Стартовый остаток настроен не полностью. Нужна проверка базы Notion.");
      if (
        input.parsed.balanceObservations.length === 1 &&
        anchor.sourceId === sourceId(input, "balance", 1)
      ) {
        return {
          status: "saved",
          openingBalanceCreated: false,
          transactionCount: input.parsed.transactions.length,
          debtOperationCount: input.parsed.debtOperations.length,
          balanceObservationCount: 1,
          historicalOperationCount: [
            ...input.parsed.transactions,
            ...input.parsed.debtOperations
          ].filter((item) => item.occurredOn < anchor.occurredOn).length,
          currentBalance: anchor.balance,
          baseCurrency: "EUR"
        };
      }

      const ordered = orderOperations(input.parsed);
      const converted = await Promise.all(
        ordered.map(async (operation) => {
          const conversion = await options.currencyConverter.convert({
            amount: operation.originalAmount,
            from: operation.originalCurrency,
            to: "EUR",
            occurredOn: operation.occurredOn
          });
          return { ...operation, conversionRate: conversion.rate, baseAmount: conversion.convertedAmount };
        })
      );

      const baseOrder = messageBaseOrder(input.sourceMessageId);
      const latestBefore = latestRow(
        await options.ledgerRepository.findLatestRunningBalanceBetween(anchor.order, baseOrder),
        await options.debtRepository.findLatestRunningBalanceBetween(anchor.order, baseOrder)
      );
      const latestOverall = latestRow(
        await options.ledgerRepository.findLatestRunningBalanceAfter(anchor.order),
        await options.debtRepository.findLatestRunningBalanceAfter(anchor.order)
      );
      const batchEnd = baseOrder + converted.length + input.parsed.balanceObservations.length + 1;
      if (latestOverall && latestOverall.order >= batchEnd) {
        throw new Error("Этот черновик старше уже сохранённых операций. Сначала нужна перерасчётка более поздних остатков.");
      }
      const active = converted.filter((operation) => operation.occurredOn >= anchor.occurredOn);
      if (latestBefore && active.some((operation) => operation.occurredOn < latestBefore.occurredOn)) {
        throw new Error("Операция попадает внутрь уже рассчитанной истории после якоря. Сначала нужна перерасчётка последующих остатков.");
      }

      let runningBalance = latestBefore?.runningBalance ?? anchor.balance;
      const prepared = converted.map((operation, index) => {
        const historical = operation.occurredOn < anchor.occurredOn;
        if (!historical) runningBalance = roundMoney(runningBalance + balanceEffect(operation, input.parsed));
        return { ...operation, order: baseOrder + index + 1, runningBalance: historical ? null : runningBalance, historical };
      });

      const observation = input.parsed.balanceObservations[0];
      let observationData: null | {
        convertedAmount: number;
        rate: number;
        difference: number;
        tolerance: number;
        status: "Совпадает" | "Принято пользователем";
      } = null;
      if (observation) {
        const latestActiveDate = active.at(-1)?.occurredOn ?? anchor.occurredOn;
        if (observation.occurredOn < latestActiveDate) {
          throw new Error("Дата общего остатка должна быть не раньше последней операции после якоря.");
        }
        const conversion = await options.currencyConverter.convert({
          amount: observation.amount, from: observation.currency, to: "EUR", occurredOn: observation.occurredOn
        });
        const difference = roundMoney(conversion.convertedAmount - runningBalance);
        const tolerance = roundMoney(Math.max(Math.abs(runningBalance) * 0.02, 5));
        if (Math.abs(difference) > tolerance && !input.acceptBalanceMismatch) {
          return { status: "balance_mismatch", observedBalance: conversion.convertedAmount, calculatedBalance: runningBalance, difference, tolerance, baseCurrency: "EUR" };
        }
        observationData = {
          convertedAmount: conversion.convertedAmount,
          rate: conversion.rate,
          difference,
          tolerance,
          status: Math.abs(difference) <= tolerance ? "Совпадает" : "Принято пользователем"
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
            baseCurrency: "EUR",
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
            baseCurrency: "EUR",
            account: debt.account!,
            comment: debt.note,
            runningBalance: item.runningBalance
          });
        }
      }

      if (observation && observationData) {
        const order = baseOrder + converted.length + 1;
        await options.balanceRepository.saveObservation({
          sourceId: sourceId(input, "balance", 1), telegramUserId: input.telegramUserId,
          order, occurredOn: observation.occurredOn, originalAmount: observation.amount,
          originalCurrency: observation.currency, conversionRate: observationData.rate,
          baseAmount: observationData.convertedAmount, baseCurrency: "EUR", account: observation.account,
          calculatedBalance: runningBalance, difference: observationData.difference,
          tolerance: observationData.tolerance, status: observationData.status,
          comment: observationData.status === "Принято пользователем" ? "Расхождение подтверждено пользователем" : null
        });
        runningBalance = observationData.convertedAmount;
      }

      return {
        status: "saved", openingBalanceCreated: false,
        transactionCount: input.parsed.transactions.length,
        debtOperationCount: input.parsed.debtOperations.length,
        balanceObservationCount: input.parsed.balanceObservations.length,
        historicalOperationCount: prepared.filter((item) => item.historical).length,
        currentBalance: runningBalance, baseCurrency: "EUR"
      };
    }
  };
}

async function initializeOpeningBalance(options: Options, input: MasterBudgetSaveInput): Promise<MasterBudgetSaveResult> {
  if (input.parsed.transactions.length || input.parsed.debtOperations.length || input.parsed.balanceObservations.length !== 1) {
    throw new Error("Сначала пришлите только точный общий остаток и дату — это станет стартовым якорем.");
  }
  const observation = input.parsed.balanceObservations[0]!;
  const conversion = await options.currencyConverter.convert({ amount: observation.amount, from: observation.currency, to: "EUR", occurredOn: observation.occurredOn });
  const order = messageBaseOrder(input.sourceMessageId) + 1;
  await options.balanceRepository.saveObservation({
    sourceId: sourceId(input, "balance", 1), telegramUserId: input.telegramUserId,
    order, occurredOn: observation.occurredOn, originalAmount: observation.amount,
    originalCurrency: observation.currency, conversionRate: conversion.rate,
    baseAmount: conversion.convertedAmount, baseCurrency: "EUR", account: observation.account,
    calculatedBalance: conversion.convertedAmount, difference: 0, tolerance: roundMoney(Math.max(Math.abs(conversion.convertedAmount) * 0.02, 5)),
    status: "Принято пользователем", comment: "Стартовый остаток"
  });
  await options.openingBalanceRepository.initialize({ amountEur: conversion.convertedAmount, effectiveOn: observation.occurredOn });
  return { status: "saved", openingBalanceCreated: true, transactionCount: 0, debtOperationCount: 0, balanceObservationCount: 1, historicalOperationCount: 0, currentBalance: conversion.convertedAmount, baseCurrency: "EUR" };
}

function orderOperations(parsed: ParsedBudgetMessageDraft): ConvertedOperation[] {
  const items: ConvertedOperation[] = [
    ...parsed.transactions.map((item, originalIndex) => ({ kind: "transaction" as const, originalIndex, occurredOn: item.occurredOn, originalAmount: item.amount!, originalCurrency: item.currency!, conversionRate: 0, baseAmount: 0 })),
    ...parsed.debtOperations.map((item, originalIndex) => ({ kind: "debt" as const, originalIndex, occurredOn: item.occurredOn, originalAmount: item.amount!, originalCurrency: item.currency!, conversionRate: 0, baseAmount: 0 }))
  ];
  return items.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || kindOrder(a.kind) - kindOrder(b.kind) || a.originalIndex - b.originalIndex);
}

function balanceEffect(operation: ConvertedOperation, parsed: ParsedBudgetMessageDraft) {
  if (operation.kind === "transaction") {
    const direction = parsed.transactions[operation.originalIndex]!.direction;
    return direction === "income" ? operation.baseAmount : direction === "expense" ? -operation.baseAmount : 0;
  }
  const action = parsed.debtOperations[operation.originalIndex]!.action;
  return action === "borrow" || action === "collect" ? operation.baseAmount : -operation.baseAmount;
}

function validateCompleteDraft(parsed: ParsedBudgetMessageDraft) {
  if (!parsed.transactions.length && !parsed.debtOperations.length && !parsed.balanceObservations.length) throw new Error("В черновике нет финансовых данных для записи.");
  if (parsed.ambiguities.length) throw new Error("Сначала исправьте все уточнения в черновике.");
  if (parsed.balanceObservations.length > 1) throw new Error("В одном сообщении поддерживается один общий остаток.");
  for (const transaction of parsed.transactions) {
    if (transaction.amount === null || transaction.currency === null || !transaction.account || (transaction.direction !== "transfer" && !transaction.category) || (transaction.direction === "transfer" && !transaction.destinationAccount) || transaction.ambiguities.length) throw new Error("Сначала заполните все поля операций в черновике.");
  }
  for (const debt of parsed.debtOperations) {
    if (debt.amount === null || debt.currency === null || !debt.counterparty || !debt.account || debt.ambiguities.length) throw new Error("Сначала заполните все поля долговых операций в черновике.");
  }
  for (const balance of parsed.balanceObservations) if (balance.ambiguities.length) throw new Error("Сначала уточните общий остаток.");
}

function validateIdentity(input: MasterBudgetSaveInput) {
  if (!/^\d{1,20}$/.test(input.telegramUserId) || !/^-?\d{1,20}$/.test(input.chatId)) throw new Error("Telegram identity is invalid.");
  if (!Number.isSafeInteger(input.sourceMessageId) || input.sourceMessageId < 0) throw new Error("Telegram source message ID is invalid.");
}
function sourceId(input: MasterBudgetSaveInput, kind: string, index: number) { return `${input.chatId}:${input.sourceMessageId}:${kind}:${index}`; }
function messageBaseOrder(messageId: number) { const value = messageId * 100; if (!Number.isSafeInteger(value)) throw new Error("Telegram message ID is too large for ordering."); return value; }
function latestRow(...rows: Array<MasterRunningBalanceRow | null>) { return rows.filter((row): row is MasterRunningBalanceRow => row !== null).sort((a, b) => b.order - a.order)[0] ?? null; }
function kindOrder(kind: ConvertedOperation["kind"]) { return kind === "transaction" ? 0 : 1; }
function roundMoney(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }
