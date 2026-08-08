import { CURRENCIES } from "../../budget/catalog.js";
import type { SupportedCurrency } from "../../budget/userSettings.js";

export type OpeningBalance = {
  amount: number;
  currency: SupportedCurrency;
  effectiveOn: string;
};

export type MasterOpeningBalanceRepository = {
  find(): Promise<OpeningBalance | null>;
  initialize(balance: OpeningBalance): Promise<{ created: boolean }>;
};

type Options = {
  apiKey: string;
  dataSourceId: string;
  masterTelegramUserId: string;
  fetchImpl?: typeof fetch;
};

const NOTION_VERSION = "2026-03-11";

export function createNotionMasterOpeningBalanceRepository(
  options: Options
): MasterOpeningBalanceRepository {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async find() {
      const page = await findSettingsPage(fetchImpl, options);
      return page ? readOpeningBalance(page) : null;
    },

    async initialize(balance) {
      validateBalance(balance);
      const page = await findSettingsPage(fetchImpl, options);
      if (!page) {
        throw new Error("Master settings must exist before the opening balance is initialized.");
      }
      const current = readOpeningBalance(page);
      if (current) {
        if (
          current.amount === balance.amount &&
          current.currency === balance.currency &&
          current.effectiveOn === balance.effectiveOn
        ) {
          return { created: false };
        }
        throw new Error("The opening balance is already initialized.");
      }
      const id = requiredString(page.id, "settings page ID");
      const response = await fetchImpl(
        `https://api.notion.com/v1/pages/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: headers(options.apiKey),
          body: JSON.stringify({
            properties: {
              "Начальный остаток": { number: balance.amount },
              "Дата начального остатка": { date: { start: balance.effectiveOn } }
            }
          })
        }
      );
      if (!response.ok) {
        throw new Error(`Notion opening balance write failed (${response.status}): ${await readError(response)}`);
      }
      return { created: true };
    }
  };
}

async function findSettingsPage(fetchImpl: typeof fetch, options: Options) {
  const response = await fetchImpl(
    `https://api.notion.com/v1/data_sources/${encodeURIComponent(options.dataSourceId)}/query`,
    {
      method: "POST",
      headers: headers(options.apiKey),
      body: JSON.stringify({
        filter: {
          property: "Telegram ID",
          rich_text: { equals: options.masterTelegramUserId }
        },
        page_size: 2
      })
    }
  );
  if (!response.ok) {
    throw new Error(`Notion opening balance query failed (${response.status}): ${await readError(response)}`);
  }
  const body = (await response.json()) as { results?: unknown[] };
  if (!Array.isArray(body.results)) throw new Error("Notion opening balance query returned invalid results.");
  if (body.results.length > 1) throw new Error("Notion contains duplicate master settings rows.");
  return body.results[0] ? requireRecord(body.results[0], "settings page") : null;
}

function readOpeningBalance(page: Record<string, unknown>): OpeningBalance | null {
  const properties = requireRecord(page.properties, "settings properties");
  const amount = requireRecord(properties["Начальный остаток"], "opening amount property").number;
  const currency = requireRecord(requireRecord(properties["Основная валюта"], "base currency property").select, "base currency select").name;
  const dateValue = requireRecord(properties["Дата начального остатка"], "opening date property").date;
  if (amount === null && dateValue === null) return null;
  if (!Number.isFinite(amount) || !dateValue) throw new Error("Notion opening balance is only partially configured.");
  const effectiveOn = requiredString(requireRecord(dateValue, "opening date").start, "opening date");
  if (typeof currency !== "string" || !(CURRENCIES as readonly string[]).includes(currency)) {
    throw new Error("Notion opening balance currency is invalid.");
  }
  const result = { amount: Number(amount), currency: currency as SupportedCurrency, effectiveOn };
  validateBalance(result);
  return result;
}

function validateBalance(balance: OpeningBalance) {
  if (!Number.isFinite(balance.amount)) throw new Error("Opening balance must be finite.");
  if (!(CURRENCIES as readonly string[]).includes(balance.currency)) throw new Error("Opening balance currency is not supported.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(balance.effectiveOn)) throw new Error("Opening balance date must use YYYY-MM-DD.");
}
function headers(apiKey: string) { return { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "notion-version": NOTION_VERSION }; }
function requireRecord(value: unknown, label: string): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`Notion ${label} is invalid.`); return value as Record<string, unknown>; }
function requiredString(value: unknown, label: string) { if (typeof value !== "string" || !value) throw new Error(`Notion ${label} is invalid.`); return value; }
async function readError(response: Response) { try { return ((await response.json()) as { message?: string }).message?.trim() || response.statusText || "unknown error"; } catch { return response.statusText || "unknown error"; } }
