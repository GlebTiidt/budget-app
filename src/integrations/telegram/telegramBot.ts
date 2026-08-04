import { Bot, InlineKeyboard } from "grammy";
import { ACCOUNTS, TRANSACTION_CATEGORIES } from "../../budget/catalog.js";
import type { AppConfig } from "../../config/loadConfig.js";
import {
  createOpenAiTransactionParser,
  type ParsedTransactionDraft,
  type TransactionTextParser
} from "../openai/openAiTransactionParser.js";

export type TelegramBot = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

type TelegramPreviewBotOptions = {
  parser?: TransactionTextParser;
};

const previewKeyboard = new InlineKeyboard()
  .text("✅ Верно", "preview:confirm")
  .text("✏️ Исправить", "preview:correct")
  .row()
  .text("✖️ Отмена", "preview:cancel");

export function createTelegramPreviewBot(
  config: AppConfig,
  options: TelegramPreviewBotOptions = {}
): Bot {
  if (!config.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  if (!config.openaiApiKey && !options.parser) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const parser =
    options.parser ??
    createOpenAiTransactionParser({
      apiKey: config.openaiApiKey!,
      model: config.openaiModel,
      timezone: config.timezone,
      categories: [...TRANSACTION_CATEGORIES],
      accounts: [...ACCOUNTS]
    });
  const bot = new Bot(config.telegramBotToken);

  bot.use(async (ctx, next) => {
    if (!isTelegramUserAllowed(ctx.from?.id, config.telegramAllowedUserIds)) {
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text: "Нет доступа." });
      } else if (ctx.chat) {
        await ctx.reply("Этот тестовый бот пока доступен только владельцу.");
      }
      return;
    }

    await next();
  });

  bot.command("start", async (ctx) => {
    await ctx.reply(
      [
        "Привет! Я тестовая версия бюджетного помощника.",
        "",
        "Напишите операцию обычным языком, например:",
        "Сегодня заплатил 120к донгов за кофе по QR.",
        "",
        "Я покажу черновик, но пока ничего не запишу в Notion."
      ].join("\n")
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "Сейчас можно тестировать распознавание одной операции.",
        "Укажите сумму, валюту и назначение; дату и счёт можно написать словами.",
        "",
        "Примеры:",
        "• Вчера продукты 350к VND по QR",
        "• Получил 500 USD за фриланс",
        "• Сегодня бензин 100к донгов",
        "",
        "Это preview: подтверждение пока не сохраняет данные в Notion."
      ].join("\n")
    );
  });

  bot.callbackQuery("preview:confirm", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Черновик проверен." });
    await ctx.reply(
      "✅ Понял. Это был тест черновика — в Notion ничего не записано."
    );
  });

  bot.callbackQuery("preview:correct", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("✏️ Отправьте исправленную операцию новым сообщением.");
  });

  bot.callbackQuery("preview:cancel", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Черновик отменён." });
    await ctx.reply("Черновик отменён. В Notion ничего не записано.");
  });

  bot.on("message:text", async (ctx) => {
    await ctx.replyWithChatAction("typing");

    try {
      const draft = await parser.parse(ctx.message.text);
      await ctx.reply(formatDraftPreview(draft), {
        reply_markup: previewKeyboard
      });
    } catch (error: unknown) {
      console.error(
        "Telegram preview parsing failed",
        error instanceof Error ? error.message : "unknown error"
      );
      await ctx.reply(
        "Не получилось уверенно разобрать операцию. Напишите сумму, валюту и назначение чуть точнее."
      );
    }
  });

  return bot;
}

export function createTelegramBot(config: AppConfig): TelegramBot {
  const bot = createTelegramPreviewBot(config);

  return {
    async start() {
      await bot.start({
        allowed_updates: ["message", "callback_query"]
      });
    },
    async stop() {
      await bot.stop();
    }
  };
}

export function isTelegramUserAllowed(
  userId: number | undefined,
  allowedUserIds: string[]
): boolean {
  return userId !== undefined && allowedUserIds.includes(String(userId));
}

export function formatDraftPreview(draft: ParsedTransactionDraft): string {
  const direction = {
    expense: "Расход",
    income: "Доход",
    transfer: "Перевод"
  }[draft.direction];
  const confidence =
    draft.confidence >= 0.85
      ? "высокая"
      : draft.confidence >= 0.6
        ? "средняя"
        : "низкая — лучше уточнить";
  const ambiguities = draft.ambiguities.length
    ? `\n\nНужно уточнить:\n${draft.ambiguities.map((item) => `• ${item}`).join("\n")}`
    : "";

  return [
    "Проверьте, правильно ли я понял:",
    "",
    `${direction}: ${formatAmount(draft.amount)} ${draft.currency}`,
    `Дата: ${formatIsoDate(draft.occurredOn)}`,
    `Категория: ${draft.category ?? "не определена"}`,
    `Счёт: ${draft.account ?? "не указан"}`,
    `Описание: ${draft.description}`,
    draft.note ? `Комментарий: ${draft.note}` : null,
    `Уверенность: ${confidence}${ambiguities}`,
    "",
    "Пока это только тестовый черновик — в Notion ничего не записано."
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2
  }).format(value);
}

function formatIsoDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}
