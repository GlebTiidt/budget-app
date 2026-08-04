import { loadConfig } from "../config/loadConfig.js";
import { createTelegramBot } from "../integrations/telegram/telegramBot.js";

async function main(): Promise<void> {
  const config = loadConfig();

  console.log("Budget bot preview starting", {
    timezone: config.timezone,
    telegramConfigured: Boolean(config.telegramBotToken),
    notionConfigured: Boolean(
      config.notionApiKey &&
        config.notionBudgetDatabaseId &&
        config.notionBudgetDataSourceId
    ),
    openaiConfigured: Boolean(config.openaiApiKey),
    openaiModel: config.openaiModel
  });

  const bot = createTelegramBot(config);
  const stop = () => {
    void bot.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await bot.start();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
