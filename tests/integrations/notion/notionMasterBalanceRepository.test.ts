import assert from "node:assert/strict";
import test from "node:test";
import { createNotionMasterBalanceRepository, type MasterBalanceObservationWrite } from "../../../src/integrations/notion/notionMasterBalanceRepository.js";

test("writes an accepted balance observation idempotently", async () => {
  const calls: any[] = [];
  const repository = createNotionMasterBalanceRepository({
    apiKey: "secret", dataSourceId: "balances", fetchImpl: async (input, init) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return calls.length === 1 ? Response.json({ results: [] }) : Response.json({ id: "balance-page" });
    }
  });
  assert.deepEqual(await repository.saveObservation(observation()), { pageId: "balance-page", created: true });
  assert.deepEqual(calls[1].body.properties["Статус"], { select: { name: "Принято пользователем" } });
  assert.deepEqual(calls[1].body.properties["Порядок"], { number: 2001 });
});

test("reads the latest accepted balance anchor", async () => {
  const repository = createNotionMasterBalanceRepository({
    apiKey: "secret", dataSourceId: "balances", fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.sorts[0].property, "Порядок");
      return Response.json({ results: [{ id: "anchor", properties: {
        "Порядок": { number: 2001 }, "Дата": { date: { start: "2026-08-08" } }, "Сумма EUR": { number: 132 },
        "Telegram ID": { rich_text: [{ plain_text: "10:20:balance:1" }] }
      } }] });
    }
  });
  assert.deepEqual(await repository.findLatestAccepted(), { pageId: "anchor", sourceId: "10:20:balance:1", order: 2001, occurredOn: "2026-08-08", balance: 132 });
});

function observation(): MasterBalanceObservationWrite {
  return {
    sourceId: "10:20:balance:1", telegramUserId: "10", order: 2001,
    occurredOn: "2026-08-08", originalAmount: 132, originalCurrency: "EUR",
    conversionRate: 1, baseAmount: 132, baseCurrency: "EUR", account: null,
    calculatedBalance: 132, difference: 0, tolerance: 5,
    status: "Принято пользователем", comment: "Стартовый остаток"
  };
}
