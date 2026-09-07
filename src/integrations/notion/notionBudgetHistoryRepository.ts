import { calculateBalanceTimeline, type BudgetHistory, type BalanceOperation, type OpeningAnchor } from "../../budget/balanceTimeline.js";
import { isSupportedCurrency } from "../../budget/userSettings.js";

export type BudgetHistoryRepository = {
  read(): Promise<BudgetHistory>;
  repair(opening: OpeningAnchor): Promise<number>;
};
type Options = { apiKey: string; transactionDataSourceId: string; debtDataSourceId: string; balanceDataSourceId: string; fetchImpl?: typeof fetch };

export function createNotionBudgetHistoryRepository(options: Options): BudgetHistoryRepository {
  const request = options.fetchImpl ?? fetch;
  const headers = { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json", "notion-version": "2026-03-11" };
  async function query(id: string): Promise<Record<string, any>[]> {
    const rows: Record<string, any>[] = [];
    let cursor: string | undefined;
    do {
      const response = await request(`https://api.notion.com/v1/data_sources/${encodeURIComponent(id)}/query`, {
        method: "POST", headers, body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) })
      });
      if (!response.ok) throw new Error(`Notion history query failed (${response.status}).`);
      const body = await response.json() as { results?: Record<string, any>[]; has_more?: boolean; next_cursor?: string };
      if (!Array.isArray(body.results) || (body.has_more && !body.next_cursor)) throw new Error("Notion history response is invalid.");
      rows.push(...body.results);
      cursor = body.has_more ? body.next_cursor : undefined;
    } while (cursor);
    return rows;
  }
  const repository: BudgetHistoryRepository = {
    async read() {
      const [transactions, debts, anchors] = await Promise.all([
        query(options.transactionDataSourceId), query(options.debtDataSourceId), query(options.balanceDataSourceId)
      ]);
      return {
        operations: [...transactions.map(row => mapOperation(row, "transaction")), ...debts.map(row => mapOperation(row, "debt"))],
        anchors: anchors.filter(row => row.properties["Якорь"]?.checkbox === true && ["Совпадает", "Принято пользователем"].includes(row.properties["Статус"]?.select?.name))
          .map(row => ({ pageId: string(row.id), sourceId: richText(row.properties["Telegram ID"]), occurredOn: date(row.properties), order: number(row.properties["Порядок"]?.number), balance: number(row.properties["Итоговый остаток"]?.number), baseCurrency: currency(row.properties), createdAt: string(row.created_time) }))
      };
    },
    async repair(opening) {
      const history = await repository.read();
      const timeline = calculateBalanceTimeline(opening, history);
      for (const row of history.operations) {
        const expected = timeline.runningBalances.get(row.sourceId) ?? null;
        if (expected === row.runningBalance) continue;
        const response = await request(`https://api.notion.com/v1/pages/${encodeURIComponent(row.pageId)}`, {
          method: "PATCH", headers, body: JSON.stringify({ properties: { "Остаток в основной валюте": { number: expected } } })
        });
        if (!response.ok) throw new Error(`Notion balance recalculation failed (${response.status}).`);
      }
      return timeline.currentBalance;
    }
  };
  return repository;
}

function mapOperation(row: Record<string, any>, kind: "transaction" | "debt"): BalanceOperation {
  const p = row.properties;
  const baseAmount = number(p["Сумма в основной валюте"]?.number);
  const directions = { "Доход": "income", "Расход": "expense", "Перевод": "transfer" } as const;
  const actions = { "Взял в долг": "borrow", "Вернул долг": "repay_borrowed", "Дал в долг": "lend", "Мне вернули долг": "collect" } as const;
  const direction = directions[p["Тип"]?.select?.name as keyof typeof directions];
  const action = actions[p["Действие"]?.select?.name as keyof typeof actions];
  if (kind === "transaction" ? !direction : !action) throw new Error("Notion history operation type is invalid.");
  const sign = kind === "transaction" ? (direction === "income" ? 1 : direction === "expense" ? -1 : 0) : (action === "borrow" || action === "collect" ? 1 : -1);
  return {
    pageId: string(row.id), sourceId: richText(p["Telegram ID"]), kind, occurredOn: date(p), order: number(p["Порядок"]?.number), baseCurrency: currency(p),
    baseAmount, effect: baseAmount * sign, runningBalance: p["Остаток в основной валюте"]?.number === null ? null : number(p["Остаток в основной валюте"]?.number),
    direction, action, category: p["Категория"]?.select?.name ?? null, description: (p["Операция"]?.title ?? []).map((v: any) => v.plain_text).join(""),
    originalAmount: number(p["Исходная сумма"]?.number), originalCurrency: string(p["Валюта"]?.select?.name), counterparty: kind === "debt" ? richText(p["Контрагент"]) : undefined
  };
}
function number(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Notion history number is invalid."); return value; }
function string(value: unknown): string { if (typeof value !== "string" || !value) throw new Error("Notion history text is invalid."); return value; }
function richText(value: any): string { return string(value?.rich_text?.map((v: any) => v.plain_text).join("")); }
function date(props: any): string { const value = string(props["Дата"]?.date?.start); if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Notion history date is invalid."); return value; }
function currency(props: any) { const value = props["Основная валюта"]?.select?.name; if (!isSupportedCurrency(value)) throw new Error("Notion history currency is invalid."); return value; }
