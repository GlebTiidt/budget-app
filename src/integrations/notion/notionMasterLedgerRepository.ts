import { ACCOUNTS, CURRENCIES, TRANSACTION_CATEGORIES } from "../../budget/catalog.js";
import type { SupportedCurrency } from "../../budget/userSettings.js";
import type { TransactionDirection } from "../../budget/types.js";

export type MasterLedgerTransactionWrite = {
  sourceId: string;
  telegramUserId: string;
  order: number;
  description: string;
  occurredOn: string;
  direction: TransactionDirection;
  originalAmount: number;
  originalCurrency: string;
  conversionRate: number;
  baseAmount: number;
  baseCurrency: SupportedCurrency;
  category: string | null;
  account: string;
  destinationAccount: string | null;
  comment: string | null;
  runningBalance: number | null;
};

export type MasterLedgerWriteResult = {
  pageId: string;
  created: boolean;
};

export type MasterRunningBalanceRow = {
  order: number;
  occurredOn: string;
  runningBalance: number;
};

export type MasterLedgerRepository = {
  saveTransaction(
    transaction: MasterLedgerTransactionWrite
  ): Promise<MasterLedgerWriteResult>;
  findLatestRunningBalanceAfter(order: number): Promise<MasterRunningBalanceRow | null>;
  findLatestRunningBalanceBetween(
    afterOrder: number,
    beforeOrder: number
  ): Promise<MasterRunningBalanceRow | null>;
};

type NotionMasterLedgerRepositoryOptions = {
  apiKey: string;
  dataSourceId: string;
  fetchImpl?: typeof fetch;
};

type NotionQueryResponse = {
  results: unknown[];
};

const NOTION_VERSION = "2026-03-11";

export function createNotionMasterLedgerRepository(
  options: NotionMasterLedgerRepositoryOptions
): MasterLedgerRepository {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async saveTransaction(transaction) {
      validateTransaction(transaction);
      const existingPageIds = await findPageIdsBySourceId(
        fetchImpl,
        options,
        transaction.sourceId
      );
      if (existingPageIds.length > 1) {
        throw new Error(
          `Notion contains duplicate transaction source ID ${transaction.sourceId}.`
        );
      }
      if (existingPageIds[0]) {
        return { pageId: existingPageIds[0], created: false };
      }

      const response = await fetchImpl("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: notionHeaders(options.apiKey),
        body: JSON.stringify({
          parent: {
            type: "data_source_id",
            data_source_id: options.dataSourceId
          },
          properties: transactionProperties(transaction)
        })
      });
      if (!response.ok) {
        throw new Error(
          `Notion transaction write failed (${response.status}): ${await readNotionError(response)}`
        );
      }
      const page = (await response.json()) as { id?: unknown };
      if (typeof page.id !== "string" || !page.id) {
        throw new Error("Notion transaction write returned no page ID.");
      }
      return { pageId: page.id, created: true };
    },

    async findLatestRunningBalanceAfter(order) {
      validateOrder(order);
      const response = await fetchImpl(
        `https://api.notion.com/v1/data_sources/${encodeURIComponent(options.dataSourceId)}/query`,
        {
          method: "POST",
          headers: notionHeaders(options.apiKey),
          body: JSON.stringify({
            filter: { and: [
              { property: "Порядок", number: { greater_than: order } },
              { property: "Остаток EUR", number: { is_not_empty: true } }
            ] },
            sorts: [{ property: "Порядок", direction: "descending" }],
            page_size: 1
          })
        }
      );
      if (!response.ok) {
        throw new Error(`Notion transaction balance query failed (${response.status}): ${await readNotionError(response)}`);
      }
      const body = (await response.json()) as { results?: unknown[] };
      if (!Array.isArray(body.results)) throw new Error("Notion transaction balance query returned invalid results.");
      return body.results[0] ? mapRunningBalance(body.results[0]) : null;
    },

    async findLatestRunningBalanceBetween(afterOrder, beforeOrder) {
      validateOrder(afterOrder);
      validateOrder(beforeOrder);
      if (beforeOrder <= afterOrder) return null;
      const response = await fetchImpl(
        `https://api.notion.com/v1/data_sources/${encodeURIComponent(options.dataSourceId)}/query`,
        {
          method: "POST",
          headers: notionHeaders(options.apiKey),
          body: JSON.stringify({
            filter: {
              and: [
                { property: "Порядок", number: { greater_than: afterOrder } },
                { property: "Порядок", number: { less_than: beforeOrder } },
                { property: "Остаток EUR", number: { is_not_empty: true } }
              ]
            },
            sorts: [{ property: "Порядок", direction: "descending" }],
            page_size: 1
          })
        }
      );
      if (!response.ok) throw new Error(`Notion transaction balance query failed (${response.status}): ${await readNotionError(response)}`);
      const body = (await response.json()) as { results?: unknown[] };
      if (!Array.isArray(body.results)) throw new Error("Notion transaction balance query returned invalid results.");
      return body.results[0] ? mapRunningBalance(body.results[0]) : null;
    }
  };
}

function mapRunningBalance(value: unknown): MasterRunningBalanceRow {
  const page = asRecord(value);
  const properties = asRecord(page?.properties);
  const order = asRecord(properties?.["Порядок"])?.number;
  const balance = asRecord(properties?.["Остаток EUR"])?.number;
  const date = asRecord(asRecord(properties?.["Дата"])?.date)?.start;
  if (!Number.isSafeInteger(order) || typeof balance !== "number" || !Number.isFinite(balance) || typeof date !== "string") {
    throw new Error("Notion transaction contains an invalid running balance row.");
  }
  return { order: Number(order), occurredOn: date, runningBalance: balance };
}

async function findPageIdsBySourceId(
  fetchImpl: typeof fetch,
  options: NotionMasterLedgerRepositoryOptions,
  sourceId: string
): Promise<string[]> {
  const response = await fetchImpl(
    `https://api.notion.com/v1/data_sources/${encodeURIComponent(options.dataSourceId)}/query`,
    {
      method: "POST",
      headers: notionHeaders(options.apiKey),
      body: JSON.stringify({
        filter: {
          property: "Telegram ID",
          rich_text: { equals: sourceId }
        },
        page_size: 2
      })
    }
  );
  if (!response.ok) {
    throw new Error(
      `Notion transaction idempotency query failed (${response.status}): ${await readNotionError(response)}`
    );
  }
  const page = (await response.json()) as NotionQueryResponse;
  if (!Array.isArray(page.results)) {
    throw new Error("Notion transaction query returned an invalid result list.");
  }
  return page.results.map((result) => {
    const id = asRecord(result)?.id;
    if (typeof id !== "string" || !id) {
      throw new Error("Notion transaction query returned an invalid page ID.");
    }
    return id;
  });
}

function transactionProperties(transaction: MasterLedgerTransactionWrite) {
  return {
    "Операция": titleProperty(transaction.description),
    "Дата": { date: { start: transaction.occurredOn } },
    "Тип": { select: { name: directionName(transaction.direction) } },
    "Исходная сумма": { number: transaction.originalAmount },
    "Валюта": { select: { name: transaction.originalCurrency } },
    "Курс к EUR": { number: transaction.conversionRate },
    "Сумма EUR": { number: transaction.baseAmount },
    "Категория": transaction.category
      ? { select: { name: transaction.category } }
      : { select: null },
    "Счёт": { select: { name: transaction.account } },
    "Счёт назначения": transaction.destinationAccount
      ? { select: { name: transaction.destinationAccount } }
      : { select: null },
    "Комментарий": richTextProperty(transaction.comment),
    "Telegram ID": richTextProperty(transaction.sourceId),
    "Остаток EUR": { number: transaction.runningBalance },
    "Порядок": { number: transaction.order }
  };
}

function directionName(direction: TransactionDirection): string {
  return {
    income: "Доход",
    expense: "Расход",
    transfer: "Перевод"
  }[direction];
}

function titleProperty(value: string) {
  return {
    title: [{ type: "text", text: { content: value } }]
  };
}

function richTextProperty(value: string | null) {
  return {
    rich_text: value
      ? [{ type: "text", text: { content: value } }]
      : []
  };
}

function notionHeaders(apiKey: string) {
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "notion-version": NOTION_VERSION
  };
}

function validateTransaction(transaction: MasterLedgerTransactionWrite): void {
  requireText(transaction.sourceId, "Transaction source ID");
  if (!/^\d{1,20}$/.test(transaction.telegramUserId)) {
    throw new Error("Transaction Telegram user ID is invalid.");
  }
  if (!Number.isSafeInteger(transaction.order) || transaction.order < 0) {
    throw new Error("Transaction order must be a non-negative safe integer.");
  }
  requireText(transaction.description, "Transaction description");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transaction.occurredOn)) {
    throw new Error("Transaction date must use YYYY-MM-DD.");
  }
  requirePositiveNumber(transaction.originalAmount, "Transaction original amount");
  requirePositiveNumber(transaction.conversionRate, "Transaction conversion rate");
  requireNonNegativeNumber(transaction.baseAmount, "Transaction EUR amount");
  if (transaction.baseCurrency !== "EUR") {
    throw new Error(
      "The current Notion ledger supports EUR as the base currency only."
    );
  }
  if (!(CURRENCIES as readonly string[]).includes(transaction.originalCurrency)) {
    throw new Error("Transaction currency is not supported.");
  }
  if (
    transaction.category !== null &&
    !(TRANSACTION_CATEGORIES as readonly string[]).includes(transaction.category)
  ) {
    throw new Error("Transaction category is not supported.");
  }
  if (transaction.direction === "transfer" && transaction.category !== null) {
    throw new Error("Personal transfers cannot have an income or expense category.");
  }
  if (transaction.direction !== "transfer" && transaction.category === null) {
    throw new Error("Income and expense transactions require a category.");
  }
  if (!(ACCOUNTS as readonly string[]).includes(transaction.account)) {
    throw new Error("Transaction account is not supported.");
  }
  if (transaction.direction === "transfer") {
    if (
      !transaction.destinationAccount ||
      !(ACCOUNTS as readonly string[]).includes(transaction.destinationAccount)
    ) {
      throw new Error("Personal transfers require a supported destination account.");
    }
  } else if (transaction.destinationAccount !== null) {
    throw new Error("Only personal transfers may have a destination account.");
  }
  if (
    transaction.runningBalance !== null &&
    !Number.isFinite(transaction.runningBalance)
  ) {
    throw new Error("Transaction running balance must be finite.");
  }
}

function validateOrder(order: number): void {
  if (!Number.isSafeInteger(order) || order < 0) throw new Error("Balance query order is invalid.");
}

function requireText(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`${label} is required.`);
  }
}

function requirePositiveNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive.`);
  }
}

function requireNonNegativeNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be non-negative.`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readNotionError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message?.trim() || response.statusText || "unknown error";
  } catch {
    return response.statusText || "unknown error";
  }
}
