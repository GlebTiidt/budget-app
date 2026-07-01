import type { AppConfig } from "../../config/loadConfig.js";

export type TelegramBot = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

export function createTelegramBot(config: AppConfig): TelegramBot {
  return {
    async start() {
      if (!config.telegramBotToken) {
        throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
      }

      // TODO: Wire Telegram client and command handlers.
    },
    async stop() {
      // TODO: Stop Telegram polling or webhook server.
    }
  };
}
