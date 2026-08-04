import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { webhookCallback } from "grammy";
import { loadConfig } from "../src/config/loadConfig.js";
import { createTelegramPreviewBot } from "../src/integrations/telegram/telegramBot.js";

const config = loadConfig();

if (!config.telegramBotToken) {
  throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
}

const bot = createTelegramPreviewBot(config);
const telegramWebhook = webhookCallback(bot, "http", {
  secretToken: deriveTelegramWebhookSecret(config.telegramBotToken),
  timeoutMilliseconds: 55_000,
  onTimeout: "return"
});

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, service: "telegram-preview" }));
    return;
  }

  if (request.method !== "POST") {
    response.writeHead(405, { allow: "GET, POST" });
    response.end();
    return;
  }

  await telegramWebhook(request, response);
}

export function deriveTelegramWebhookSecret(token: string): string {
  return createHash("sha256")
    .update(`budget-app-telegram-webhook:${token}`)
    .digest("hex");
}
