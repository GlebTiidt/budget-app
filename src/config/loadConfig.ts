export type AppConfig = {
  telegramBotToken: string | undefined;
  telegramAllowedUserIds: string[];
  masterTelegramUserId: string | undefined;
  userDatabasePath: string;
  reportsWebAppUrl: string | undefined;
  notionApiKey: string | undefined;
  notionBudgetDatabaseId: string | undefined;
  notionBudgetDataSourceId: string | undefined;
  notionMasterSettingsDataSourceId: string | undefined;
  openaiApiKey: string | undefined;
  openaiModel: string;
  quickChartBaseUrl: string;
  timezone: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const telegramAllowedUserIds = splitCsv(env.TELEGRAM_ALLOWED_USER_IDS);
  return {
    telegramBotToken: emptyToUndefined(env.TELEGRAM_BOT_TOKEN),
    telegramAllowedUserIds,
    masterTelegramUserId:
      optionalTelegramUserId(env.MASTER_TELEGRAM_USER_ID) ??
      (telegramAllowedUserIds.length === 1
        ? telegramAllowedUserIds[0]
        : undefined),
    userDatabasePath:
      emptyToUndefined(env.USER_DATABASE_PATH) ?? ".data/budget-app.sqlite",
    reportsWebAppUrl: optionalHttpsUrl(env.REPORTS_WEB_APP_URL),
    notionApiKey: emptyToUndefined(env.NOTION_API_KEY),
    notionBudgetDatabaseId: emptyToUndefined(env.NOTION_BUDGET_DATABASE_ID),
    notionBudgetDataSourceId: emptyToUndefined(env.NOTION_BUDGET_DATA_SOURCE_ID),
    notionMasterSettingsDataSourceId: emptyToUndefined(
      env.NOTION_MASTER_SETTINGS_DATA_SOURCE_ID
    ),
    openaiApiKey: emptyToUndefined(env.OPENAI_API_KEY),
    openaiModel: emptyToUndefined(env.OPENAI_MODEL) ?? "gpt-5.6-luna",
    quickChartBaseUrl:
      emptyToUndefined(env.QUICKCHART_BASE_URL) ?? "https://quickchart.io/chart",
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

function optionalHttpsUrl(value: string | undefined): string | undefined {
  const normalized = emptyToUndefined(value);
  if (!normalized) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("REPORTS_WEB_APP_URL must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("REPORTS_WEB_APP_URL must be a valid HTTPS URL.");
  }
  return url.toString();
}

function optionalTelegramUserId(value: string | undefined): string | undefined {
  const normalized = emptyToUndefined(value);
  if (!normalized) {
    return undefined;
  }
  if (!/^\d{1,20}$/.test(normalized)) {
    throw new Error("MASTER_TELEGRAM_USER_ID must contain only digits.");
  }
  return normalized;
}
