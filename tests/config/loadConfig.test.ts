import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../src/config/loadConfig.js";

test("loadConfig applies safe integration defaults", () => {
  const config = loadConfig({});

  assert.equal(config.openaiModel, "gpt-5.6-luna");
  assert.equal(config.quickChartBaseUrl, "https://quickchart.io/chart");
  assert.equal(config.timezone, "Asia/Ho_Chi_Minh");
  assert.deepEqual(config.telegramAllowedUserIds, []);
});

test("loadConfig trims secrets and splits the Telegram allowlist", () => {
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: " telegram-secret ",
    TELEGRAM_ALLOWED_USER_IDS: "123, 456,",
    OPENAI_API_KEY: " openai-secret "
  });

  assert.equal(config.telegramBotToken, "telegram-secret");
  assert.equal(config.openaiApiKey, "openai-secret");
  assert.deepEqual(config.telegramAllowedUserIds, ["123", "456"]);
});
