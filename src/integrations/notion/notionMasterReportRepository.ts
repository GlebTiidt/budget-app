import type {
  MasterLedgerTransaction,
  ReportDirection
} from "../../reports/masterReport.js";
import { validateMonth } from "../../reports/masterReport.js";

type NotionMasterReportRepositoryOptions = {
  apiKey: string;
  dataSourceId: string;
  fetchImpl?: typeof fetch;
};

type NotionQueryResponse = {
  results: unknown[];
  has_more: boolean;
  next_cursor: string | null;
};

export type MasterReportRepository = {
  listTransactions(month: string): Promise<MasterLedgerTransaction[]>;
};

const NOTION_VERSION = "2026-03-11";

export function createNotionMasterReportRepository(
  options: NotionMasterReportRepositoryOptions
): MasterReportRepository {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async listTransactions(month) {
      validateMonth(month);
      const transactions: MasterLedgerTransaction[] = [];
      let cursor: string | null = null;

      do {
        const response = await fetchImpl(
          `https://api.notion.com/v1/data_sources/${encodeURIComponent(options.dataSourceId)}/query`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${options.apiKey}`,
              "content-type": "application/json",
              "notion-version": NOTION_VERSION
            },
            body: JSON.stringify({
              filter: {
                and: [
                  {
                    property: "Дата",
                    date: { on_or_after: `${month}-01` }
                  },
                  {
                    property: "Дата",
                    date: { before: firstDayOfNextMonth(month) }
                  }
                ]
              },
              sorts: [{ property: "Дата", direction: "ascending" }],
              page_size: 100,
              ...(cursor ? { start_cursor: cursor } : {})
            })
          }
        );

        if (!response.ok) {
          throw new Error(
            `Notion report query failed (${response.status}): ${await readNotionError(response)}`
          );
        }

        const page = (await response.json()) as NotionQueryResponse;
        if (!Array.isArray(page.results)) {
          throw new Error("Notion report query returned an invalid result list.");
        }

        for (const result of page.results) {
          const transaction = mapNotionTransaction(result);
          if (transaction) {
            transactions.push(transaction);
          }
        }

        cursor = page.has_more ? page.next_cursor : null;
        if (page.has_more && !cursor) {
          throw new Error("Notion report query omitted its next cursor.");
        }
      } while (cursor);

      return transactions;
    }
  };
}

function mapNotionTransaction(value: unknown): MasterLedgerTransaction | null {
  const page = asRecord(value);
  const properties = asRecord(page?.properties);
  if (!page || !properties) {
    return null;
  }

  const occurredOn = readDate(properties["Дата"]);
  const direction = readDirection(properties["Тип"]);
  const amount = readNumber(properties["Сумма EUR"]);
  if (!occurredOn || !direction || amount === null || amount < 0) {
    return null;
  }

  return {
    occurredOn,
    direction,
    amount,
    category: readSelect(properties["Категория"])
  };
}

function readDirection(value: unknown): ReportDirection | null {
  const selected = readSelect(value)?.toLocaleLowerCase("ru-RU");
  if (selected === "доход" || selected === "income") {
    return "income";
  }
  if (selected === "расход" || selected === "expense") {
    return "expense";
  }
  if (selected === "перевод" || selected === "transfer") {
    return "transfer";
  }
  return null;
}

function readDate(value: unknown): string | null {
  const property = asRecord(value);
  const date = asRecord(property?.date);
  const start = date?.start;
  return typeof start === "string" && /^\d{4}-\d{2}-\d{2}/.test(start)
    ? start.slice(0, 10)
    : null;
}

function readNumber(value: unknown): number | null {
  const property = asRecord(value);
  return typeof property?.number === "number" && Number.isFinite(property.number)
    ? property.number
    : null;
}

function readSelect(value: unknown): string | null {
  const property = asRecord(value);
  const selected = asRecord(property?.select);
  return typeof selected?.name === "string" ? selected.name.trim() || null : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstDayOfNextMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year!, monthNumber!, 1));
  return next.toISOString().slice(0, 10);
}

async function readNotionError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message?.trim() || response.statusText || "unknown error";
  } catch {
    return response.statusText || "unknown error";
  }
}
