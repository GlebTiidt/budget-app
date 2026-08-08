import { ACCOUNTS, CURRENCIES } from "../../budget/catalog.js";
import type { DebtAction } from "../../budget/types.js";
import type { SupportedCurrency } from "../../budget/userSettings.js";

export type MasterDebtOperationWrite = {
  sourceId: string;
  telegramUserId: string;
  order: number;
  description: string;
  occurredOn: string;
  action: DebtAction;
  counterparty: string;
  originalAmount: number;
  originalCurrency: string;
  conversionRate: number;
  baseAmount: number;
  baseCurrency: SupportedCurrency;
  account: string;
  comment: string | null;
  runningBalance: number | null;
};

export type MasterDebtWriteResult = { pageId: string; created: boolean };

export type MasterDebtRepository = {
  saveDebtOperation(
    operation: MasterDebtOperationWrite
  ): Promise<MasterDebtWriteResult>;
  findLatestRunningBalanceAfter(order: number): Promise<{ order: number; occurredOn: string; runningBalance: number } | null>;
  findLatestRunningBalanceBetween(afterOrder: number, beforeOrder: number): Promise<{ order: number; occurredOn: string; runningBalance: number } | null>;
};

type Options = { apiKey: string; dataSourceId: string; fetchImpl?: typeof fetch };
const NOTION_VERSION = "2026-03-11";

export function createNotionMasterDebtRepository(
  options: Options
): MasterDebtRepository {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async saveDebtOperation(operation) {
      validate(operation);
      const existing = await findIds(fetchImpl, options, operation.sourceId);
      if (existing.length > 1) {
        throw new Error(`Notion contains duplicate debt source ID ${operation.sourceId}.`);
      }
      if (existing[0]) return { pageId: existing[0], created: false };

      const response = await fetchImpl("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: headers(options.apiKey),
        body: JSON.stringify({
          parent: { type: "data_source_id", data_source_id: options.dataSourceId },
          properties: properties(operation)
        })
      });
      if (!response.ok) {
        throw new Error(`Notion debt write failed (${response.status}): ${await readError(response)}`);
      }
      const body = (await response.json()) as { id?: unknown };
      if (typeof body.id !== "string" || !body.id) {
        throw new Error("Notion debt write returned no page ID.");
      }
      return { pageId: body.id, created: true };
    },
    async findLatestRunningBalanceAfter(order) {
      if (!Number.isSafeInteger(order) || order < 0) throw new Error("Balance query order is invalid.");
      const response = await fetchImpl(`https://api.notion.com/v1/data_sources/${encodeURIComponent(options.dataSourceId)}/query`, {
        method: "POST", headers: headers(options.apiKey), body: JSON.stringify({
          filter: { and: [
            { property: "Порядок", number: { greater_than: order } },
            { property: "Остаток в основной валюте", number: { is_not_empty: true } }
          ] },
          sorts: [{ property: "Порядок", direction: "descending" }], page_size: 1
        })
      });
      if (!response.ok) throw new Error(`Notion debt balance query failed (${response.status}): ${await readError(response)}`);
      const result = (await response.json()) as { results?: unknown[] };
      if (!Array.isArray(result.results)) throw new Error("Notion debt balance query returned invalid results.");
      if (!result.results[0]) return null;
      const page = record(result.results[0]);
      const props = record(page?.properties);
      const itemOrder = record(props?.["Порядок"])?.number;
      const balance = record(props?.["Остаток в основной валюте"])?.number;
      const date = record(record(props?.["Дата"])?.date)?.start;
      if (!Number.isSafeInteger(itemOrder) || typeof balance !== "number" || !Number.isFinite(balance) || typeof date !== "string") throw new Error("Notion debt contains an invalid running balance row.");
      return { order: Number(itemOrder), occurredOn: date, runningBalance: balance };
    },
    async findLatestRunningBalanceBetween(afterOrder, beforeOrder) {
      if (!Number.isSafeInteger(afterOrder) || !Number.isSafeInteger(beforeOrder) || afterOrder < 0 || beforeOrder < 0) throw new Error("Balance query order is invalid.");
      if (beforeOrder <= afterOrder) return null;
      const response = await fetchImpl(`https://api.notion.com/v1/data_sources/${encodeURIComponent(options.dataSourceId)}/query`, {
        method: "POST", headers: headers(options.apiKey), body: JSON.stringify({
          filter: { and: [
            { property: "Порядок", number: { greater_than: afterOrder } },
            { property: "Порядок", number: { less_than: beforeOrder } },
            { property: "Остаток в основной валюте", number: { is_not_empty: true } }
          ] },
          sorts: [{ property: "Порядок", direction: "descending" }], page_size: 1
        })
      });
      if (!response.ok) throw new Error(`Notion debt balance query failed (${response.status}): ${await readError(response)}`);
      const result = (await response.json()) as { results?: unknown[] };
      if (!Array.isArray(result.results)) throw new Error("Notion debt balance query returned invalid results.");
      if (!result.results[0]) return null;
      const page = record(result.results[0]);
      const props = record(page?.properties);
      const itemOrder = record(props?.["Порядок"])?.number;
      const balance = record(props?.["Остаток в основной валюте"])?.number;
      const date = record(record(props?.["Дата"])?.date)?.start;
      if (!Number.isSafeInteger(itemOrder) || typeof balance !== "number" || !Number.isFinite(balance) || typeof date !== "string") throw new Error("Notion debt contains an invalid running balance row.");
      return { order: Number(itemOrder), occurredOn: date, runningBalance: balance };
    }
  };
}

async function findIds(fetchImpl: typeof fetch, options: Options, sourceId: string) {
  const response = await fetchImpl(
    `https://api.notion.com/v1/data_sources/${encodeURIComponent(options.dataSourceId)}/query`,
    {
      method: "POST",
      headers: headers(options.apiKey),
      body: JSON.stringify({
        filter: { property: "Telegram ID", rich_text: { equals: sourceId } },
        page_size: 2
      })
    }
  );
  if (!response.ok) {
    throw new Error(`Notion debt idempotency query failed (${response.status}): ${await readError(response)}`);
  }
  const body = (await response.json()) as { results?: unknown[] };
  if (!Array.isArray(body.results)) throw new Error("Notion debt query returned invalid results.");
  return body.results.map((item) => {
    const id = record(item)?.id;
    if (typeof id !== "string" || !id) throw new Error("Notion debt query returned an invalid page ID.");
    return id;
  });
}

function properties(operation: MasterDebtOperationWrite) {
  return {
    "Операция": title(operation.description),
    "Дата": { date: { start: operation.occurredOn } },
    "Действие": { select: { name: actionName(operation.action) } },
    "Контрагент": richText(operation.counterparty),
    "Исходная сумма": { number: operation.originalAmount },
    "Валюта": { select: { name: operation.originalCurrency } },
    "Курс к основной валюте": { number: operation.conversionRate },
    "Сумма в основной валюте": { number: operation.baseAmount },
    "Основная валюта": { select: { name: operation.baseCurrency } },
    "Счёт": { select: { name: operation.account } },
    "Комментарий": richText(operation.comment),
    "Telegram ID": richText(operation.sourceId),
    "Остаток в основной валюте": { number: operation.runningBalance },
    "Порядок": { number: operation.order }
  };
}

function actionName(action: DebtAction) {
  return {
    borrow: "Взял в долг",
    repay_borrowed: "Вернул долг",
    lend: "Дал в долг",
    collect: "Мне вернули долг"
  }[action];
}

function title(value: string) { return { title: [{ type: "text", text: { content: value } }] }; }
function richText(value: string | null) {
  return { rich_text: value ? [{ type: "text", text: { content: value } }] : [] };
}
function headers(apiKey: string) {
  return { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "notion-version": NOTION_VERSION };
}

function validate(operation: MasterDebtOperationWrite) {
  if (!operation.sourceId.trim()) throw new Error("Debt source ID is required.");
  if (!/^\d{1,20}$/.test(operation.telegramUserId)) throw new Error("Debt Telegram user ID is invalid.");
  if (!Number.isSafeInteger(operation.order) || operation.order < 0) throw new Error("Debt order is invalid.");
  if (!operation.description.trim()) throw new Error("Debt description is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(operation.occurredOn)) throw new Error("Debt date must use YYYY-MM-DD.");
  if (!operation.counterparty.trim()) throw new Error("Debt counterparty is required.");
  if (!Number.isFinite(operation.originalAmount) || operation.originalAmount <= 0) throw new Error("Debt amount must be positive.");
  if (!(CURRENCIES as readonly string[]).includes(operation.originalCurrency)) throw new Error("Debt currency is not supported.");
  if (!Number.isFinite(operation.conversionRate) || operation.conversionRate <= 0) throw new Error("Debt conversion rate must be positive.");
  if (!Number.isFinite(operation.baseAmount) || operation.baseAmount < 0) throw new Error("Debt base-currency amount must be non-negative.");
  if (!(CURRENCIES as readonly string[]).includes(operation.baseCurrency)) throw new Error("Debt base currency is not supported.");
  if (!(ACCOUNTS as readonly string[]).includes(operation.account)) throw new Error("Debt account is not supported.");
  if (operation.runningBalance !== null && !Number.isFinite(operation.runningBalance)) throw new Error("Debt running balance must be finite.");
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
async function readError(response: Response) {
  try { return ((await response.json()) as { message?: string }).message?.trim() || response.statusText || "unknown error"; }
  catch { return response.statusText || "unknown error"; }
}
