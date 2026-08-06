import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../src/config/loadConfig.js";
import { createConfiguredUserSettingsRepository } from "../../src/storage/configuredUserSettingsRepository.js";

test("fails closed instead of putting master settings in local SQLite", async () => {
  const repository = createConfiguredUserSettingsRepository(
    loadConfig({
      MASTER_TELEGRAM_USER_ID: "100001",
      USER_DATABASE_PATH: ":memory:"
    })
  );

  try {
    await assert.rejects(
      repository.findByTelegramUserId("100001"),
      /private Notion settings data source/
    );
  } finally {
    repository.close();
  }
});

test("keeps a non-master profile in the application database", async () => {
  const repository = createConfiguredUserSettingsRepository(
    loadConfig({
      MASTER_TELEGRAM_USER_ID: "100001",
      USER_DATABASE_PATH: ":memory:"
    })
  );

  try {
    await repository.save({
      telegramUserId: "200002",
      baseCurrency: "VND",
      onboardingHelpShown: true
    });
    assert.deepEqual(await repository.findByTelegramUserId("200002"), {
      telegramUserId: "200002",
      baseCurrency: "VND",
      onboardingHelpShown: true
    });
  } finally {
    repository.close();
  }
});
