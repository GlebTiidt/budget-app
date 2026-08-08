import { ACCOUNTS, CURRENCIES } from "../../budget/catalog.js";
import type { SupportedCurrency } from "../../budget/userSettings.js";

export type BalanceObservationStatus = "Совпадает" | "Требует сверки" | "Принято пользователем";
export type MasterBalanceObservationWrite = {
  sourceId: string;
  telegramUserId: string;
  order: number;
  occurredOn: string;
  originalAmount: number;
  originalCurrency: string;
  conversionRate: number;
  baseAmount: number;
  baseCurrency: SupportedCurrency;
  account: string | null;
  calculatedBalance: number;
  difference: number;
  tolerance: number;
  status: BalanceObservationStatus;
  comment: string | null;
};
export type AcceptedBalanceAnchor = {
  pageId: string;
  sourceId: string;
  order: number;
  occurredOn: string;
  balance: number;
};
export type MasterBalanceRepository = {
  saveObservation(input: MasterBalanceObservationWrite): Promise<{ pageId: string; created: boolean }>;
  findLatestAccepted(): Promise<AcceptedBalanceAnchor | null>;
};
type Options = { apiKey: string; dataSourceId: string; fetchImpl?: typeof fetch };
const NOTION_VERSION = "2026-03-11";

export function createNotionMasterBalanceRepository(options: Options): MasterBalanceRepository {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async saveObservation(input) {
      validate(input);
      const existing = await query(fetchImpl, options, {
        filter: { property: "Telegram ID", rich_text: { equals: input.sourceId } },
        page_size: 2
      });
      if (existing.length > 1) throw new Error(`Notion contains duplicate balance source ID ${input.sourceId}.`);
      const existingId = pageId(existing[0]);
      if (existingId) return { pageId: existingId, created: false };
      const response = await fetchImpl("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: headers(options.apiKey),
        body: JSON.stringify({
          parent: { type: "data_source_id", data_source_id: options.dataSourceId },
          properties: properties(input)
        })
      });
      if (!response.ok) throw new Error(`Notion balance write failed (${response.status}): ${await readError(response)}`);
      const created = (await response.json()) as { id?: unknown };
      if (typeof created.id !== "string" || !created.id) throw new Error("Notion balance write returned no page ID.");
      return { pageId: created.id, created: true };
    },
    async findLatestAccepted() {
      const rows = await query(fetchImpl, options, {
        filter: { or: [
          { property: "Статус", select: { equals: "Совпадает" } },
          { property: "Статус", select: { equals: "Принято пользователем" } }
        ] },
        sorts: [{ property: "Порядок", direction: "descending" }],
        page_size: 1
      });
      if (!rows[0]) return null;
      const page = requireRecord(rows[0], "balance page");
      const props = requireRecord(page.properties, "balance properties");
      return {
        pageId: requiredString(page.id, "balance page ID"),
        sourceId: richTextProperty(props["Telegram ID"]),
        order: numberProperty(props["Порядок"]),
        occurredOn: dateProperty(props["Дата"]),
        balance: numberProperty(props["Сумма EUR"])
      };
    }
  };
}

async function query(fetchImpl: typeof fetch, options: Options, body: unknown) {
  const response = await fetchImpl(`https://api.notion.com/v1/data_sources/${encodeURIComponent(options.dataSourceId)}/query`, {
    method: "POST", headers: headers(options.apiKey), body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Notion balance query failed (${response.status}): ${await readError(response)}`);
  const result = (await response.json()) as { results?: unknown[] };
  if (!Array.isArray(result.results)) throw new Error("Notion balance query returned invalid results.");
  return result.results;
}

function properties(input: MasterBalanceObservationWrite) {
  return {
    "Наблюдение": { title: [{ type: "text", text: { content: "Общий остаток" } }] },
    "Дата": { date: { start: input.occurredOn } },
    "Исходная сумма": { number: input.originalAmount },
    "Валюта": { select: { name: input.originalCurrency } },
    "Курс к EUR": { number: input.conversionRate },
    "Сумма EUR": { number: input.baseAmount },
    "Счёт": input.account ? { select: { name: input.account } } : { select: null },
    "Рассчитанный остаток EUR": { number: input.calculatedBalance },
    "Разница EUR": { number: input.difference },
    "Допуск EUR": { number: input.tolerance },
    "Статус": { select: { name: input.status } },
    "Telegram ID": { rich_text: [{ type: "text", text: { content: input.sourceId } }] },
    "Комментарий": { rich_text: input.comment ? [{ type: "text", text: { content: input.comment } }] : [] },
    "Порядок": { number: input.order }
  };
}

function validate(input: MasterBalanceObservationWrite) {
  if (!input.sourceId.trim()) throw new Error("Balance source ID is required.");
  if (!/^\d{1,20}$/.test(input.telegramUserId)) throw new Error("Balance Telegram user ID is invalid.");
  if (!Number.isSafeInteger(input.order) || input.order < 0) throw new Error("Balance order is invalid.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)) throw new Error("Balance date must use YYYY-MM-DD.");
  if (!Number.isFinite(input.originalAmount) || input.originalAmount <= 0) throw new Error("Observed balance must be positive.");
  if (!(CURRENCIES as readonly string[]).includes(input.originalCurrency)) throw new Error("Balance currency is not supported.");
  if (input.baseCurrency !== "EUR") throw new Error("The current Notion balance ledger supports EUR as the base currency only.");
  if (!Number.isFinite(input.conversionRate) || input.conversionRate <= 0) throw new Error("Balance conversion rate must be positive.");
  for (const value of [input.baseAmount, input.calculatedBalance, input.difference, input.tolerance]) {
    if (!Number.isFinite(value)) throw new Error("Balance values must be finite.");
  }
  if (input.tolerance < 0) throw new Error("Balance tolerance must be non-negative.");
  if (input.account && !(ACCOUNTS as readonly string[]).includes(input.account)) throw new Error("Balance account is not supported.");
}

function pageId(value: unknown) { const id = value && requireRecord(value, "page").id; return typeof id === "string" ? id : null; }
function numberProperty(value: unknown) { const number = requireRecord(value, "number property").number; if (!Number.isFinite(number)) throw new Error("Notion balance number is invalid."); return Number(number); }
function dateProperty(value: unknown) { const start = requireRecord(requireRecord(value, "date property").date, "date").start; return requiredString(start, "balance date"); }
function richTextProperty(value: unknown) {
  const items = requireRecord(value, "rich text property").rich_text;
  if (!Array.isArray(items)) throw new Error("Notion balance rich text is invalid.");
  return items.map((item) => requiredString(requireRecord(item, "rich text item").plain_text, "balance rich text")).join("");
}
function requireRecord(value: unknown, label: string): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`Notion ${label} is invalid.`); return value as Record<string, unknown>; }
function requiredString(value: unknown, label: string) { if (typeof value !== "string" || !value) throw new Error(`Notion ${label} is invalid.`); return value; }
function headers(apiKey: string) { return { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "notion-version": NOTION_VERSION }; }
async function readError(response: Response) { try { return ((await response.json()) as { message?: string }).message?.trim() || response.statusText || "unknown error"; } catch { return response.statusText || "unknown error"; } }
