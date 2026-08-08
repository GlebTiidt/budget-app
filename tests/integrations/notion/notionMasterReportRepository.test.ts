import assert from "node:assert/strict";
import test from "node:test";
import { createNotionMasterReportRepository } from "../../../src/integrations/notion/notionMasterReportRepository.js";

test("queries every Notion page for one month and maps report fields", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const responses = [
    {
      results: [notionRow("2026-08-06", "Доход", 800, "Работа")],
      has_more: true,
      next_cursor: "next-page"
    },
    {
      results: [
        notionRow("2026-08-07", "Расход", 35.5, "Транспорт"),
        notionRow("2026-08-07", "Перевод", 500, null),
        { object: "page", properties: {} }
      ],
      has_more: false,
      next_cursor: null
    }
  ];
  const repository = createNotionMasterReportRepository({
    apiKey: "notion-secret",
    dataSourceId: "data-source-id",
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return Response.json(responses[requests.length - 1]);
    }
  });

  const transactions = await repository.listTransactions("2026-08");

  assert.deepEqual(transactions, [
    {
      occurredOn: "2026-08-06",
      direction: "income",
      amount: 800,
      category: "Работа"
    },
    {
      occurredOn: "2026-08-07",
      direction: "expense",
      amount: 35.5,
      category: "Транспорт"
    },
    {
      occurredOn: "2026-08-07",
      direction: "transfer",
      amount: 500,
      category: null
    }
  ]);
  assert.equal(requests.length, 2);
  assert.match(requests[0]!.url, /data_sources\/data-source-id\/query$/);
  assert.equal(requests[1]!.body.start_cursor, "next-page");
  assert.deepEqual(
    (requests[0]!.body.filter as { and: unknown[] }).and,
    [
      { property: "Дата", date: { on_or_after: "2026-08-01" } },
      { property: "Дата", date: { before: "2026-09-01" } }
    ]
  );
});

function notionRow(
  occurredOn: string,
  direction: string,
  amount: number,
  category: string | null
) {
  return {
    object: "page",
    properties: {
      Дата: { type: "date", date: { start: occurredOn, end: null } },
      Тип: { type: "select", select: { name: direction } },
      "Сумма в основной валюте": { type: "number", number: amount },
      Категория: {
        type: "select",
        select: category ? { name: category } : null
      }
    }
  };
}
