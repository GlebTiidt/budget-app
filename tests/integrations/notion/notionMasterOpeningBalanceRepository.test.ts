import assert from "node:assert/strict";
import test from "node:test";
import { createNotionMasterOpeningBalanceRepository } from "../../../src/integrations/notion/notionMasterOpeningBalanceRepository.js";

test("initializes the empty master opening balance", async () => {
  const calls: any[] = [];
  const repository = createNotionMasterOpeningBalanceRepository({
    apiKey: "secret", dataSourceId: "settings", masterTelegramUserId: "10",
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      if (calls.length === 1) return Response.json({ results: [settingsPage(null, null)] });
      return Response.json({ id: "settings-page" });
    }
  });
  assert.deepEqual(await repository.initialize({ amountEur: 132, effectiveOn: "2026-08-08" }), { created: true });
  assert.deepEqual(calls[1].body.properties["Начальный остаток EUR"], { number: 132 });
});

test("treats the same opening balance as an idempotent retry", async () => {
  let calls = 0;
  const repository = createNotionMasterOpeningBalanceRepository({
    apiKey: "secret", dataSourceId: "settings", masterTelegramUserId: "10",
    fetchImpl: async () => { calls += 1; return Response.json({ results: [settingsPage(132, "2026-08-08")] }); }
  });
  assert.deepEqual(await repository.initialize({ amountEur: 132, effectiveOn: "2026-08-08" }), { created: false });
  assert.equal(calls, 1);
});

test("rejects replacement of an existing opening balance", async () => {
  const repository = createNotionMasterOpeningBalanceRepository({
    apiKey: "secret", dataSourceId: "settings", masterTelegramUserId: "10",
    fetchImpl: async () => Response.json({ results: [settingsPage(100, "2026-08-01")] })
  });
  await assert.rejects(repository.initialize({ amountEur: 132, effectiveOn: "2026-08-08" }), /already initialized/);
});

function settingsPage(amount: number | null, date: string | null) {
  return { id: "settings-page", properties: {
    "Начальный остаток EUR": { number: amount },
    "Дата начального остатка": { date: date ? { start: date } : null }
  } };
}
