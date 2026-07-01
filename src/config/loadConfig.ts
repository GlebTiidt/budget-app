export type AppConfig = {
  telegramBotToken: string | undefined;
  telegramAllowedUserIds: string[];
  notionApiKey: string | undefined;
  notionBudgetDatabaseId: string | undefined;
  timezone: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    telegramBotToken: emptyToUndefined(env.TELEGRAM_BOT_TOKEN),
    telegramAllowedUserIds: splitCsv(env.TELEGRAM_ALLOWED_USER_IDS),
    notionApiKey: emptyToUndefined(env.NOTION_API_KEY),
    notionBudgetDatabaseId: emptyToUndefined(env.NOTION_BUDGET_DATABASE_ID),
    timezone: emptyToUndefined(env.APP_TIMEZONE) ?? "Asia/Ho_Chi_Minh"
  };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function splitCsv(value: string | undefined): string[] {
  return value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) ?? [];
}
