import assert from "node:assert/strict";
import test from "node:test";
import { createNotionMasterDebtRepository, type MasterDebtOperationWrite } from "../../../src/integrations/notion/notionMasterDebtRepository.js";

test("writes a debt row after checking its stable source ID", async () => {
  const calls: any[] = [];
  const repository = createNotionMasterDebtRepository({
    apiKey: "secret", dataSourceId: "debts", fetchImpl: async (input, init) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return calls.length === 1 ? Response.json({ results: [] }) : Response.json({ id: "debt-page" });
    }
  });
  assert.deepEqual(await repository.saveDebtOperation(debt()), { pageId: "debt-page", created: true });
  assert.deepEqual(calls[0].body.filter, { property: "Telegram ID", rich_text: { equals: "10:20:debt:1" } });
  assert.deepEqual(calls[1].body.properties["Действие"], { select: { name: "Дал в долг" } });
  assert.deepEqual(calls[1].body.properties["Остаток EUR"], { number: 900 });
});

test("does not duplicate an existing debt source ID", async () => {
  let calls = 0;
  const repository = createNotionMasterDebtRepository({
    apiKey: "secret", dataSourceId: "debts", fetchImpl: async () => {
      calls += 1; return Response.json({ results: [{ id: "existing" }] });
    }
  });
  assert.deepEqual(await repository.saveDebtOperation(debt()), { pageId: "existing", created: false });
  assert.equal(calls, 1);
});

function debt(): MasterDebtOperationWrite {
  return {
    sourceId: "10:20:debt:1", telegramUserId: "10", order: 2001,
    description: "Займ Илье", occurredOn: "2026-08-08", action: "lend",
    counterparty: "Илья", originalAmount: 100, originalCurrency: "EUR",
    conversionRate: 1, baseAmount: 100, baseCurrency: "EUR", account: "Карта",
    comment: null, runningBalance: 900
  };
}
