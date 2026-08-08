import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "../src/config/loadConfig.js";
import { createNotionMasterReportRepository } from "../src/integrations/notion/notionMasterReportRepository.js";
import { createNotionMasterUserSettingsRepository } from "../src/integrations/notion/notionMasterUserSettingsRepository.js";
import {
  isTelegramMasterUserAllowed,
  verifyTelegramWebAppInitData
} from "../src/integrations/telegram/telegramWebAppAuth.js";
import { buildMasterReport, validateMonth } from "../src/reports/masterReport.js";

const config = loadConfig();

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("vary", "x-telegram-init-data");
  response.setHeader("x-content-type-options", "nosniff");

  if (request.method !== "GET") {
    response.writeHead(405, { allow: "GET" });
    response.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  if (
    !config.telegramBotToken ||
    !config.masterTelegramUserId ||
    !config.notionApiKey ||
    !config.notionBudgetDataSourceId ||
    !config.notionMasterSettingsDataSourceId
  ) {
    response.statusCode = 503;
    response.end(JSON.stringify({ error: "report_not_configured" }));
    return;
  }

  const initData = readHeader(request, "x-telegram-init-data");
  if (!initData) {
    response.statusCode = 401;
    response.end(JSON.stringify({ error: "telegram_authorization_required" }));
    return;
  }

  let userId: string;
  try {
    userId = verifyTelegramWebAppInitData(initData, config.telegramBotToken).userId;
  } catch {
    response.statusCode = 401;
    response.end(JSON.stringify({ error: "telegram_authorization_invalid" }));
    return;
  }
  if (
    !isTelegramMasterUserAllowed(
      userId,
      config.masterTelegramUserId,
      config.telegramAllowedUserIds
    )
  ) {
    response.statusCode = 403;
    response.end(JSON.stringify({ error: "access_denied" }));
    return;
  }

  const requestUrl = new URL(request.url ?? "/api/reports", "https://budget.local");
  const month = requestUrl.searchParams.get("month") ?? currentMonth();
  try {
    validateMonth(month);
  } catch {
    response.statusCode = 400;
    response.end(JSON.stringify({ error: "invalid_month" }));
    return;
  }

  try {
    const repository = createNotionMasterReportRepository({
      apiKey: config.notionApiKey,
      dataSourceId: config.notionBudgetDataSourceId
    });
    const settingsRepository = createNotionMasterUserSettingsRepository({
      apiKey: config.notionApiKey,
      dataSourceId: config.notionMasterSettingsDataSourceId,
      masterTelegramUserId: config.masterTelegramUserId
    });
    const [transactions, settings] = await Promise.all([
      repository.listTransactions(month),
      settingsRepository.findByTelegramUserId(userId)
    ]);
    if (!settings) throw new Error("Master settings are missing.");
    response.statusCode = 200;
    response.end(
      JSON.stringify(buildMasterReport(month, transactions, settings.baseCurrency))
    );
  } catch (error: unknown) {
    console.error(
      "Master report query failed",
      error instanceof Error ? error.message : "unknown error"
    );
    response.statusCode = 502;
    response.end(JSON.stringify({ error: "report_query_failed" }));
  }
}

function readHeader(
  request: IncomingMessage,
  name: string
): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
}
