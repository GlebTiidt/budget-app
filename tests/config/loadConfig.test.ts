import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../src/config/loadConfig.js";

test("loadConfig applies safe integration defaults", () => {
  const config = loadConfig({});

  assert.equal(config.openaiModel, "gpt-5.6-luna");
  assert.equal(config.quickChartBaseUrl, "https://quickchart.io/chart");
  assert.equal(config.timezone, "Asia/Ho_Chi_Minh");
  assert.equal(config.userDatabasePath, ".data/budget-app.sqlite");
  assert.equal(config.reportsWebAppUrl, undefined);
  assert.equal(config.masterTelegramUserId, undefined);
  assert.deepEqual(config.telegramAllowedUserIds, []);
});

test("loadConfig trims secrets and splits the Telegram allowlist", () => {
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: " telegram-secret ",
    TELEGRAM_ALLOWED_USER_IDS: "123, 456,",
    USER_DATABASE_PATH: " /srv/budget/users.sqlite ",
    REPORTS_WEB_APP_URL: " https://budget.example/reports.html ",
    MASTER_TELEGRAM_USER_ID: " 123 ",
    NOTION_MASTER_SETTINGS_DATA_SOURCE_ID: " master-settings ",
    OPENAI_API_KEY: " openai-secret "
  });

  assert.equal(config.telegramBotToken, "telegram-secret");
  assert.equal(config.openaiApiKey, "openai-secret");
  assert.equal(config.userDatabasePath, "/srv/budget/users.sqlite");
  assert.equal(config.reportsWebAppUrl, "https://budget.example/reports.html");
  assert.equal(config.masterTelegramUserId, "123");
  assert.equal(
    config.notionMasterSettingsDataSourceId,
    "master-settings"
  );
  assert.deepEqual(config.telegramAllowedUserIds, ["123", "456"]);
});

test("loadConfig rejects an invalid master Telegram user ID", () => {
  assert.throws(
    () => loadConfig({ MASTER_TELEGRAM_USER_ID: "owner" }),
    /only digits/
  );
});

test("loadConfig treats the sole allowed preview user as the master", () => {
  const config = loadConfig({ TELEGRAM_ALLOWED_USER_IDS: "100001" });
  assert.equal(config.masterTelegramUserId, "100001");
});

test("loadConfig rejects an insecure Telegram reports URL", () => {
  assert.throws(
    () => loadConfig({ REPORTS_WEB_APP_URL: "http://budget.example/reports" }),
    /valid HTTPS URL/
  );
});
