import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSqliteUserSettingsRepository } from "../../src/storage/sqliteUserSettingsRepository.js";

test("stores one isolated settings row per Telegram user", async () => {
  const repository = createSqliteUserSettingsRepository(":memory:");

  try {
    assert.equal(await repository.findByTelegramUserId("100001"), null);

    await repository.save({
      telegramUserId: "100001",
      baseCurrency: "EUR",
      onboardingHelpShown: true
    });
    await repository.save({
      telegramUserId: "200002",
      baseCurrency: "VND",
      onboardingHelpShown: false
    });
    await repository.save({
      telegramUserId: "100001",
      baseCurrency: "USD",
      onboardingHelpShown: true
    });

    assert.deepEqual(await repository.findByTelegramUserId("100001"), {
      telegramUserId: "100001",
      baseCurrency: "USD",
      onboardingHelpShown: true
    });
    assert.deepEqual(await repository.findByTelegramUserId("200002"), {
      telegramUserId: "200002",
      baseCurrency: "VND",
      onboardingHelpShown: false
    });
  } finally {
    repository.close();
  }
});

test("rejects invalid Telegram IDs before querying SQLite", async () => {
  const repository = createSqliteUserSettingsRepository(":memory:");

  try {
    await assert.rejects(
      repository.findByTelegramUserId("../another-user"),
      /Telegram user ID/
    );
  } finally {
    repository.close();
  }
});

test("persists settings after the SQLite repository is reopened", async () => {
  const directory = mkdtempSync(join(tmpdir(), "budget-user-settings-"));
  const databasePath = join(directory, "users.sqlite");
  const firstRepository = createSqliteUserSettingsRepository(databasePath);

  try {
    await firstRepository.save({
      telegramUserId: "300003",
      baseCurrency: "AUD",
      onboardingHelpShown: true
    });
  } finally {
    firstRepository.close();
  }

  const reopenedRepository = createSqliteUserSettingsRepository(databasePath);
  try {
    assert.deepEqual(
      await reopenedRepository.findByTelegramUserId("300003"),
      {
        telegramUserId: "300003",
        baseCurrency: "AUD",
        onboardingHelpShown: true
      }
    );
  } finally {
    reopenedRepository.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
