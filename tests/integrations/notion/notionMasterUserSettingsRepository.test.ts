import assert from "node:assert/strict";
import test from "node:test";
import { createNotionMasterUserSettingsRepository } from "../../../src/integrations/notion/notionMasterUserSettingsRepository.js";

test("reads the master currency from its isolated Notion settings row", async () => {
  const repository = createNotionMasterUserSettingsRepository({
    apiKey: "notion-secret",
    dataSourceId: "settings-source",
    masterTelegramUserId: "100001",
    fetchImpl: async () =>
      Response.json({
        results: [
          {
            id: "settings-page",
            properties: {
              "Основная валюта": {
                type: "select",
                select: { name: "USD" }
              },
              "Подсказки показаны": {
                type: "checkbox",
                checkbox: true
              }
            }
          }
        ]
      })
  });

  assert.deepEqual(await repository.findByTelegramUserId("100001"), {
    telegramUserId: "100001",
    baseCurrency: "USD",
    onboardingHelpShown: true
  });
  await assert.rejects(
    repository.findByTelegramUserId("200002"),
    /restricted to the master user/
  );
});

test("creates one master settings page when none exists", async () => {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  const repository = createNotionMasterUserSettingsRepository({
    apiKey: "notion-secret",
    dataSourceId: "settings-source",
    masterTelegramUserId: "100001",
    fetchImpl: async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : {}
      });
      return calls.length === 1
        ? Response.json({ results: [] })
        : Response.json({ id: "created-page" });
    }
  });

  await repository.save({
    telegramUserId: "100001",
    baseCurrency: "AUD",
    onboardingHelpShown: true
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.url, "https://api.notion.com/v1/pages");
  assert.equal(calls[1]!.method, "POST");
  assert.deepEqual(calls[1]!.body.parent, {
    type: "data_source_id",
    data_source_id: "settings-source"
  });
  const properties = calls[1]!.body.properties as Record<string, unknown>;
  assert.deepEqual(properties["Основная валюта"], {
    type: "select",
    select: { name: "AUD" }
  });
});

test("updates the existing master settings page instead of duplicating it", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const repository = createNotionMasterUserSettingsRepository({
    apiKey: "notion-secret",
    dataSourceId: "settings-source",
    masterTelegramUserId: "100001",
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      return calls.length === 1
        ? Response.json({ results: [{ id: "existing-page" }] })
        : Response.json({ id: "existing-page" });
    }
  });

  await repository.save({
    telegramUserId: "100001",
    baseCurrency: "EUR",
    onboardingHelpShown: true
  });

  assert.deepEqual(calls[1], {
    url: "https://api.notion.com/v1/pages/existing-page",
    method: "PATCH"
  });
});
