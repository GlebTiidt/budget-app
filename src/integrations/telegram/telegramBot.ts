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

type PreviewAction = "confirm" | "correct" | "cancel";
type PreviewItemKind = "transaction" | "balance";

const TELEGRAM_MESSAGE_LIMIT = 4096;
const PREVIEW_WARNING = "Preview: в Notion ничего не записано.";

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
        "Я покажу все черновики одним сообщением и отдельно отмечу, какие данные нужно уточнить.",
        "Пока ничего не запишу в Notion."
      ].join("\n")
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "Сейчас можно тестировать распознавание одной или нескольких операций в сообщении.",
        "Для каждой операции укажите сумму, валюту и назначение; дату и счёт можно написать словами.",
        "Если валюта, категория или счёт пропущены, я перечислю вопросы по номерам транзакций.",
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

  bot.callbackQuery(
    /^preview:(confirm|correct|cancel):(transaction|balance):(\d+)$/,
    async (ctx) => {
      const action = ctx.match[1] as PreviewAction;
      const kind = ctx.match[2] as PreviewItemKind;
      const position = Number(ctx.match[3]);
      const label =
        kind === "transaction"
          ? `Транзакция №${position}`
          : `Наблюдение баланса №${position}`;
      const checkedWord = kind === "transaction" ? "проверена" : "проверено";
      const cancelledWord = kind === "transaction" ? "отменена" : "отменено";

      if (action === "confirm") {
        await ctx.answerCallbackQuery({ text: `${label} ${checkedWord}.` });
        await ctx.reply(`✅ ${label} ${checkedWord}. В Notion ничего не записано.`);
        return;
      }

      if (action === "correct") {
        await ctx.answerCallbackQuery();
        await ctx.reply(
          `✏️ Отправьте исправленный текст для пункта «${label}». Я покажу новый preview.`
        );
        return;
      }

      await ctx.answerCallbackQuery({ text: `${label} ${cancelledWord}.` });
      await ctx.reply(`✖️ ${label} ${cancelledWord}. В Notion ничего не записано.`);
    }
  );

  bot.on("message:text", async (ctx) => {
    await ctx.replyWithChatAction("typing");

    try {
      const parsed = await parser.parse(ctx.message.text);
      const preview = formatBudgetMessagePreview(parsed);

      if (parsed.transactions.length || parsed.balanceObservations.length) {
        await ctx.reply(preview, {
          reply_markup: createBudgetPreviewKeyboard(parsed)
        });
      } else {
        await ctx.reply(preview);
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

export function formatBudgetMessagePreview(parsed: ParsedBudgetMessageDraft): string {
  if (parsed.transactions.length === 0 && parsed.balanceObservations.length === 0) {
    const clarificationLines = parsed.ambiguities.map(
      (item) => `• ${truncateText(item, 160)}`
    );

    return [
      "Не нашёл ни одной финансовой операции или наблюдения баланса.",
      clarificationLines.length
        ? `\nНужно уточнить:\n${clarificationLines.join("\n")}`
        : " Напишите сумму, валюту и назначение точнее.",
      `\n${PREVIEW_WARNING}`
    ].join("");
  }

  const detailed = buildBudgetMessagePreview(parsed, true);
  if (detailed.length <= TELEGRAM_MESSAGE_LIMIT) {
    return detailed;
  }

  return limitTelegramMessage(buildBudgetMessagePreview(parsed, false));
}

export function createBudgetPreviewKeyboard(
  parsed: ParsedBudgetMessageDraft
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  let hasPreviousRow = false;

  for (const [index] of parsed.transactions.entries()) {
    if (hasPreviousRow) {
      keyboard.row();
    }
    addPreviewKeyboardRow(keyboard, String(index + 1), "transaction", index + 1);
    hasPreviousRow = true;
  }

  for (const [index] of parsed.balanceObservations.entries()) {
    if (hasPreviousRow) {
      keyboard.row();
    }
    addPreviewKeyboardRow(keyboard, `Б${index + 1}`, "balance", index + 1);
    hasPreviousRow = true;
  }

  return keyboard;
}

function buildBudgetMessagePreview(
  parsed: ParsedBudgetMessageDraft,
  includeDetails: boolean
): string {
  const sections: string[] = [
    `Транзакции: ${parsed.transactions.length} · Наблюдения баланса: ${parsed.balanceObservations.length}`
  ];

  if (parsed.transactions.length) {
    sections.push(
      [
        "Транзакции:",
        ...parsed.transactions.map((draft, index) =>
          formatCombinedTransaction(draft, index + 1, includeDetails)
        )
      ].join("\n")
    );
  }

  if (parsed.balanceObservations.length) {
    sections.push(
      [
        "Наблюдения баланса (не доход и не расход):",
        ...parsed.balanceObservations.map((observation, index) =>
          formatCombinedBalanceObservation(observation, index + 1)
        )
      ].join("\n")
    );
  }

  const clarifications = collectClarificationRequests(parsed, includeDetails);
  if (clarifications.length) {
    sections.push(["Нужно уточнить:", ...clarifications].join("\n"));
  }

  sections.push(
    "Кнопки ниже относятся к номерам транзакций; «Б» означает наблюдение баланса.",
    PREVIEW_WARNING
  );

  return sections.join("\n\n");
}

function formatCombinedTransaction(
  draft: ParsedTransactionDraft,
  position: number,
  includeDetails: boolean
): string {
  const direction = {
    expense: "Расход",
    income: "Доход",
    transfer: "Перевод"
  }[draft.direction];
  const fields = [
    `${position}. ${direction} — ${formatDraftAmount(draft.amount, draft.currency)}`,
    formatIsoDate(draft.occurredOn),
    draft.category ?? "категория не указана",
    draft.account ?? "счёт не указан",
    `«${truncateText(draft.description, includeDetails ? 72 : 36)}»`
  ];

  if (includeDetails && draft.note) {
    fields.push(`комментарий: ${truncateText(draft.note, 72)}`);
  }
  if (draft.confidence < 0.6) {
    fields.push("низкая уверенность");
  }

  return fields.join(" · ");
}

function formatCombinedBalanceObservation(
  observation: ParsedBalanceObservationDraft,
  position: number
): string {
  const fields = [
    `Б${position}. ${formatAmount(observation.amount)} ${observation.currency}`,
    formatIsoDate(observation.occurredOn),
    observation.account ?? "счёт не указан"
  ];

  if (observation.confidence < 0.6) {
    fields.push("низкая уверенность");
  }

  return fields.join(" · ");
}

function collectClarificationRequests(
  parsed: ParsedBudgetMessageDraft,
  includeDetails: boolean
): string[] {
  const requests: string[] = [];

  for (const [index, draft] of parsed.transactions.entries()) {
    const missingFields: string[] = [];
    if (draft.amount === null) {
      missingFields.push("сумму");
    }
    if (draft.currency === null) {
      missingFields.push("валюту");
    }
    if (draft.direction !== "transfer" && draft.category === null) {
      missingFields.push("категорию");
    }
    if (draft.account === null) {
      missingFields.push("счёт");
    }

    if (missingFields.length) {
      requests.push(
        `• Транзакция ${index + 1} «${truncateText(draft.description, 48)}» — укажите ${joinRussianList(missingFields)}.`
      );
    }

    if (includeDetails) {
      for (const ambiguity of draft.ambiguities.filter(
        (item) => !isMissingFieldAmbiguity(item)
      )) {
        requests.push(
          `• Транзакция ${index + 1} «${truncateText(draft.description, 48)}» — ${truncateText(ambiguity, 120)}`
        );
      }
    }
  }

  for (const [index, observation] of parsed.balanceObservations.entries()) {
    if (observation.account === null) {
      requests.push(`• Наблюдение баланса Б${index + 1} — укажите счёт.`);
    }

    if (includeDetails) {
      for (const ambiguity of observation.ambiguities.filter(
        (item) => !isMissingFieldAmbiguity(item)
      )) {
        requests.push(
          `• Наблюдение баланса Б${index + 1} — ${truncateText(ambiguity, 120)}`
        );
      }
    }
  }

  if (includeDetails) {
    for (const ambiguity of parsed.ambiguities) {
      requests.push(`• По всему сообщению — ${truncateText(ambiguity, 140)}`);
    }
  }

  return requests;
}

function addPreviewKeyboardRow(
  keyboard: InlineKeyboard,
  label: string,
  kind: PreviewItemKind,
  position: number
): void {
  keyboard
    .text(`✅ ${label}`, `preview:confirm:${kind}:${position}`)
    .text(`✏️ ${label}`, `preview:correct:${kind}:${position}`)
    .text(`✖️ ${label}`, `preview:cancel:${kind}:${position}`);
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

function formatAmount(value: number): string {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2
  }).format(value);
}

function formatIsoDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function joinRussianList(items: string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "данные";
  }
  return `${items.slice(0, -1).join(", ")} и ${items.at(-1)}`;
}

function isMissingFieldAmbiguity(value: string): boolean {
  return /(не\s+указ|не\s+определ|отсутств).*(сумм|валют|категор|сч[её]т)/i.test(
    value
  );
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function limitTelegramMessage(value: string): string {
  if (value.length <= TELEGRAM_MESSAGE_LIMIT) {
    return value;
  }

  const suffix = `\n\n… Часть длинных деталей сокращена.\n${PREVIEW_WARNING}`;
  return `${value.slice(0, TELEGRAM_MESSAGE_LIMIT - suffix.length).trimEnd()}${suffix}`;
}
