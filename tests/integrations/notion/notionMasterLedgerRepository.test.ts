import assert from "node:assert/strict";
import test from "node:test";
import {
  createNotionMasterLedgerRepository,
  type MasterLedgerTransactionWrite
} from "../../../src/integrations/notion/notionMasterLedgerRepository.js";

test("writes a complete EUR ledger row after an idempotency query", async () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const repository = createNotionMasterLedgerRepository({
    apiKey: "notion-secret",
    dataSourceId: "transactions-source",
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      if (requests.length === 1) {
        return Response.json({ results: [] });
      }
      return Response.json({ id: "created-page" });
    }
  });

  const result = await repository.saveTransaction(transaction());

  assert.deepEqual(result, { pageId: "created-page", created: true });
  assert.equal(requests.length, 2);
  assert.match(requests[0]!.url, /data_sources\/transactions-source\/query$/);
  assert.deepEqual(requests[0]!.body, {
    filter: {
      property: "Telegram ID",
      rich_text: { equals: "100001:77:transaction:1" }
    },
    page_size: 2
  });
  assert.equal(requests[1]!.url, "https://api.notion.com/v1/pages");
  const createBody = requests[1]!.body as {
    parent: unknown;
    properties: Record<string, unknown>;
  };
  assert.deepEqual(createBody.parent, {
    type: "data_source_id",
    data_source_id: "transactions-source"
  });
  assert.deepEqual(createBody.properties["Тип"], {
    select: { name: "Расход" }
  });
  assert.deepEqual(createBody.properties["Категория"], {
    select: { name: "Еда" }
  });
  assert.deepEqual(createBody.properties["Счёт назначения"], { select: null });
  assert.deepEqual(createBody.properties["Telegram ID"], {
    rich_text: [
      { type: "text", text: { content: "100001:77:transaction:1" } }
    ]
  });
  assert.deepEqual(createBody.properties["Порядок"], { number: 7701 });
  assert.deepEqual(createBody.properties["Остаток EUR"], { number: 950.5 });
});

test("returns the existing page without creating a duplicate", async () => {
  let calls = 0;
  const repository = createNotionMasterLedgerRepository({
    apiKey: "notion-secret",
    dataSourceId: "transactions-source",
    fetchImpl: async () => {
      calls += 1;
      return Response.json({ results: [{ id: "existing-page" }] });
    }
  });

  assert.deepEqual(await repository.saveTransaction(transaction()), {
    pageId: "existing-page",
    created: false
  });
  assert.equal(calls, 1);
});

test("rejects non-EUR writes while the owner ledger has fixed EUR fields", async () => {
  const repository = createNotionMasterLedgerRepository({
    apiKey: "notion-secret",
    dataSourceId: "transactions-source",
    fetchImpl: async () => {
      throw new Error("fetch must not be called");
    }
  });

  await assert.rejects(
    repository.saveTransaction({ ...transaction(), baseCurrency: "USD" }),
    /supports EUR as the base currency only/
  );
});

function transaction(): MasterLedgerTransactionWrite {
  return {
    sourceId: "100001:77:transaction:1",
    telegramUserId: "100001",
    order: 7701,
    description: "Продукты",
    occurredOn: "2026-08-08",
    direction: "expense",
    originalAmount: 50,
    originalCurrency: "USD",
    conversionRate: 0.85,
    baseAmount: 42.5,
    baseCurrency: "EUR",
    category: "Еда",
    account: "Карта",
    destinationAccount: null,
    comment: "Синтетический тест",
    runningBalance: 950.5
  };
}
