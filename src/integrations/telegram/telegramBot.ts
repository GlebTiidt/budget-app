import { Bot, InlineKeyboard } from "grammy";
import {
  ACCOUNTS,
  CURRENCIES,
  TRANSACTION_CATEGORIES
} from "../../budget/catalog.js";
import type { AppConfig } from "../../config/loadConfig.js";
import {
  createOpenAiTransactionParser,
  type ParsedBalanceObservationDraft,
  type ParsedBudgetMessageDraft,
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
      accounts: [...ACCOUNTS],
      currencies: [...CURRENCIES]
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
        "Напишите одну или несколько операций обычным языком, например:",
        "Получил 500 USD за фриланс, потом заплатил 120к донгов за кофе по QR.",
        "",
        "Я разделю сообщение на отдельные черновики, но пока ничего не запишу в Notion."
      ].join("\n")
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "Сейчас можно тестировать распознавание одной или нескольких операций в сообщении.",
        "Для каждой операции укажите сумму, валюту и назначение; дату и счёт можно написать словами.",
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
    await ctx.reply(
      "✏️ Отправьте исправленное сообщение целиком. Я заново найду в нём все операции."
    );
  });

  bot.callbackQuery("preview:cancel", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Черновик отменён." });
    await ctx.reply("Черновик отменён. В Notion ничего не записано.");
  });

  bot.on("message:text", async (ctx) => {
    await ctx.replyWithChatAction("typing");

    try {
      const parsed = await parser.parse(ctx.message.text);
      await ctx.reply(formatBudgetMessageSummary(parsed));

      for (const [index, draft] of parsed.transactions.entries()) {
        await ctx.reply(
          formatDraftPreview(draft, {
            position: index + 1,
            total: parsed.transactions.length
          }),
          { reply_markup: previewKeyboard }
        );
      }

      for (const [index, observation] of parsed.balanceObservations.entries()) {
        await ctx.reply(
          formatBalanceObservationPreview(observation, {
            position: index + 1,
            total: parsed.balanceObservations.length
          }),
          { reply_markup: previewKeyboard }
        );
      }
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

type PreviewPosition = {
  position: number;
  total: number;
};

export function formatBudgetMessageSummary(parsed: ParsedBudgetMessageDraft): string {
  const incomeCount = parsed.transactions.filter(
    (draft) => draft.direction === "income"
  ).length;
  const expenseCount = parsed.transactions.filter(
    (draft) => draft.direction === "expense"
  ).length;
  const transferCount = parsed.transactions.filter(
    (draft) => draft.direction === "transfer"
  ).length;
  const ambiguities = parsed.ambiguities.length
    ? `\n\nПо всему сообщению нужно уточнить:\n${parsed.ambiguities
        .map((item) => `• ${item}`)
        .join("\n")}`
    : "";

  if (parsed.transactions.length === 0 && parsed.balanceObservations.length === 0) {
    return [
      "Не нашёл ни одной финансовой операции или наблюдения баланса.",
      parsed.ambiguities.length
        ? `\nНужно уточнить:\n${parsed.ambiguities.map((item) => `• ${item}`).join("\n")}`
        : " Напишите сумму, валюту и назначение точнее.",
      "\nПока это только тест — в Notion ничего не записано."
    ].join("");
  }

  return [
    `Нашёл транзакций: ${parsed.transactions.length}.`,
    `Доходы: ${incomeCount} · Расходы: ${expenseCount} · Переводы: ${transferCount}.`,
    `Наблюдения баланса: ${parsed.balanceObservations.length}.`,
    "Каждый черновик отправляю отдельно для проверки.",
    ambiguities
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatDraftPreview(
  draft: ParsedTransactionDraft,
  position?: PreviewPosition
): string {
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
    position
      ? `Транзакция ${position.position} из ${position.total} — проверьте:`
      : "Проверьте, правильно ли я понял:",
    "",
    `${direction}: ${formatDraftAmount(draft.amount, draft.currency)}`,
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

export function formatBalanceObservationPreview(
  observation: ParsedBalanceObservationDraft,
  position?: PreviewPosition
): string {
  const confidence = formatConfidence(observation.confidence);
  const ambiguities = observation.ambiguities.length
    ? `\n\nНужно уточнить:\n${observation.ambiguities
        .map((item) => `• ${item}`)
        .join("\n")}`
    : "";

  return [
    position
      ? `Наблюдение баланса ${position.position} из ${position.total} — проверьте:`
      : "Проверьте наблюдение баланса:",
    "",
    `Остаток: ${formatAmount(observation.amount)} ${observation.currency}`,
    `Дата: ${formatIsoDate(observation.occurredOn)}`,
    `Счёт: ${observation.account ?? "не указан"}`,
    `Уверенность: ${confidence}${ambiguities}`,
    "",
    "Это не доход и не расход.",
    "Пока это только тестовый черновик — в Notion ничего не записано."
  ].join("\n");
}

function formatDraftAmount(amount: number | null, currency: string | null): string {
  if (amount === null && currency === null) {
    return "сумма и валюта не указаны";
  }
  if (amount === null) {
    return `сумма не указана, валюта ${currency}`;
  }
  if (currency === null) {
    return `${formatAmount(amount)}, валюта не указана`;
  }
  return `${formatAmount(amount)} ${currency}`;
}

function formatConfidence(confidence: number): string {
  return confidence >= 0.85
    ? "высокая"
    : confidence >= 0.6
      ? "средняя"
      : "низкая — лучше уточнить";
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
