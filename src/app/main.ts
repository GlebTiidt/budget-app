import { loadConfig } from "../config/loadConfig.js";

async function main(): Promise<void> {
  const config = loadConfig();

  console.log("Budget app scaffold ready", {
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
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
