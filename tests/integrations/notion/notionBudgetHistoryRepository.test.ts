import assert from "node:assert/strict";
import test from "node:test";
import { createNotionBudgetHistoryRepository } from "../../../src/integrations/notion/notionBudgetHistoryRepository.js";

test("paginates original history and repairs only incorrect derived balances", async () => {
  const patches: unknown[] = [];
  const queries: any[] = [];
  const repository = createNotionBudgetHistoryRepository({ apiKey: "synthetic", transactionDataSourceId: "transactions", debtDataSourceId: "debts", balanceDataSourceId: "balances", fetchImpl: async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (init?.method === "PATCH") { patches.push(body); return Response.json({ id: "page" }); }
    if (String(url).includes("transactions")) {
      queries.push(body);
      return body.start_cursor ? Response.json({ results: [page("b", 20, 70)], has_more: false }) : Response.json({ results: [page("a", 10, 999)], has_more: true, next_cursor: "next" });
    }
    return Response.json({ results: [], has_more: false });
  } });
  const balance = await repository.repair({ amount: 100, currency: "USD", effectiveOn: "2026-08-01" });
  assert.equal(balance, 70);
  assert.equal(queries[1].start_cursor, "next");
  assert.deepEqual(patches, [{ properties: { "Остаток в основной валюте": { number: 90 } } }]);
});

function page(id: string, amount: number, balance: number) {
  return { id, properties: {
    "Telegram ID": { rich_text: [{ plain_text: id }] }, "Дата": { date: { start: "2026-08-02" } }, "Порядок": { number: id === "a" ? 1 : 2 },
    "Сумма в основной валюте": { number: amount }, "Основная валюта": { select: { name: "USD" } }, "Остаток в основной валюте": { number: balance },
    "Тип": { select: { name: "Расход" } }, "Исходная сумма": { number: amount }, "Валюта": { select: { name: "USD" } }
  } };
}
