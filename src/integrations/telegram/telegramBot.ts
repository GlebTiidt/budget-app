import { Bot } from "grammy";
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
const previewReplyMarkup = {
  force_reply: true as const,
  selective: true,
  input_field_placeholder: "Например: для всех счёт Карта"
};

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
        "Для каждой операции укажите сумму, валюту и назначение; для перевода напишите оба счёта.",
        "Если валюта, категория или счёт пропущены, я перечислю вопросы по номерам транзакций.",
        "",
        "Примеры:",
        "• Вчера продукты 350к VND по QR",
        "• Получил 500 USD за фриланс",
        "• Сегодня бензин 100к донгов",
        "• Перевёл 177 USD с Crypto на Вьетнамский счёт",
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
      const repliedPreview = getRepliedPreviewText(ctx.message.reply_to_message);
      if (repliedPreview) {
        const instruction = ctx.message.text.trim();

        if (isWholePreviewConfirmation(instruction)) {
          await ctx.reply(
            "✅ Все пункты проверены. Это preview — в Notion ничего не записано."
          );
          return;
        }

        if (isWholePreviewCancellation(instruction)) {
          await ctx.reply(
            "✖️ Весь черновик отменён. В Notion ничего не записано."
          );
          return;
        }

        try {
          const revised = await parser.revise(repliedPreview, instruction);
          await ctx.reply(formatBudgetMessagePreview(revised), {
            reply_markup: previewReplyMarkup
          });
        } catch (error: unknown) {
          console.error(
            "Telegram preview revision failed",
            error instanceof Error ? error.message : "unknown error"
          );
          await ctx.reply(
            [
              "Не понял, как изменить черновик.",
              "Ответьте на исходный preview, например: «для всех счёт Карта», «3: валюта USD» или «отмени 4»."
            ].join("\n")
          );
        }
        return;
      }

      const parsed = await parser.parse(ctx.message.text);
      const preview = formatBudgetMessagePreview(parsed);

      await ctx.reply(preview, {
        reply_markup: previewReplyMarkup
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

export function formatBudgetMessagePreview(parsed: ParsedBudgetMessageDraft): string {
  if (parsed.transactions.length === 0 && parsed.balanceObservations.length === 0) {
    const clarificationLines = parsed.ambiguities.map(
      (item) => `• ${normalizeText(item)}`
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
    [
      "Ответьте: «всё верно», «для всех счёт Вьетнамский счёт», «3: валюта USD» или «отмени 4».",
      "Можно перечислять изменения с новой строки; «тоже» повторяет последнее изменение для следующего пункта. «Б» — наблюдение баланса."
    ].join("\n"),
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
    formatIsoDate(draft.occurredOn)
  ];

  if (draft.direction === "transfer") {
    fields.push(
      `${draft.account ?? "счёт-источник не указан"} → ${draft.destinationAccount ?? "счёт-получатель не указан"}`
    );
  } else {
    fields.push(draft.category ?? "категория не указана");
    fields.push(draft.account ?? "счёт не указан");
  }

  fields.push(
    `«${
      includeDetails
        ? normalizeText(draft.description)
        : truncateText(draft.description, 36)
    }»`
  );

  if (includeDetails && draft.note) {
    fields.push(`комментарий: ${normalizeText(draft.note)}`);
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
  const messageMissingFields = new Set<MissingField>();

  for (const [index, draft] of parsed.transactions.entries()) {
    const missingFields: MissingField[] = [];
    if (draft.amount === null) {
      missingFields.push("сумму");
    }
    if (draft.currency === null) {
      missingFields.push("валюту");
    }
    if (draft.direction !== "transfer" && draft.category === null) {
      missingFields.push("категорию");
    }
    if (draft.direction === "transfer") {
      if (draft.account === null) {
        missingFields.push("счёт-источник");
      }
      if (draft.destinationAccount === null) {
        missingFields.push("счёт-получатель");
      }
    } else if (draft.account === null) {
      missingFields.push("счёт");
    }
    for (const field of missingFields) {
      messageMissingFields.add(field);
    }

    if (missingFields.length) {
      requests.push(
        `• Транзакция ${index + 1} «${
          includeDetails
            ? normalizeText(draft.description)
            : truncateText(draft.description, 48)
        }» — укажите ${joinRussianList(missingFields)}.`
      );
    }

    if (includeDetails) {
      for (const ambiguity of draft.ambiguities.filter(
        (item) => !ambiguityConcernsMissingField(item, missingFields)
      )) {
        requests.push(
          `• Транзакция ${index + 1} «${normalizeText(draft.description)}» — ${normalizeText(ambiguity)}`
        );
      }
    }
  }

  for (const [index, observation] of parsed.balanceObservations.entries()) {
    const missingFields: MissingField[] = [];
    if (observation.account === null) {
      missingFields.push("счёт");
      messageMissingFields.add("счёт");
      requests.push(`• Наблюдение баланса Б${index + 1} — укажите счёт.`);
    }

    if (includeDetails) {
      for (const ambiguity of observation.ambiguities.filter(
        (item) => !ambiguityConcernsMissingField(item, missingFields)
      )) {
        requests.push(
          `• Наблюдение баланса Б${index + 1} — ${normalizeText(ambiguity)}`
        );
      }
    }
  }

  if (includeDetails) {
    for (const ambiguity of parsed.ambiguities.filter(
      (item) =>
        !ambiguityConcernsMissingField(item, [...messageMissingFields])
    )) {
      requests.push(`• По всему сообщению — ${normalizeText(ambiguity)}`);
    }
  }

  return requests;
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

type MissingField =
  | "сумму"
  | "валюту"
  | "категорию"
  | "счёт"
  | "счёт-источник"
  | "счёт-получатель";

function ambiguityConcernsMissingField(
  value: string,
  missingFields: MissingField[]
): boolean {
  const patterns: Record<MissingField, RegExp> = {
    сумму: /сумм|amount/i,
    валюту: /валют|currency/i,
    категорию: /категор|category/i,
    счёт: /сч[её]т|account|кошел[её]к|крипт/i,
    "счёт-источник": /источник|source|откуда|со сч[её]т|с кошел/i,
    "счёт-получатель": /получател|destination|куда|на сч[её]т|в кошел/i
  };

  return missingFields.some((field) => patterns[field].test(value));
}

function truncateText(value: string, maxLength: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function limitTelegramMessage(value: string): string {
  if (value.length <= TELEGRAM_MESSAGE_LIMIT) {
    return value;
  }

  const suffix = `\n\n… Часть длинных деталей сокращена.\n${PREVIEW_WARNING}`;
  return `${value.slice(0, TELEGRAM_MESSAGE_LIMIT - suffix.length).trimEnd()}${suffix}`;
}

function getRepliedPreviewText(
  replyToMessage:
    | { text?: string; from?: { is_bot: boolean } }
    | undefined
): string | null {
  if (!replyToMessage?.from?.is_bot || !replyToMessage.text) {
    return null;
  }
  return replyToMessage.text.includes(PREVIEW_WARNING)
    ? replyToMessage.text
    : null;
}

function isWholePreviewConfirmation(value: string): boolean {
  return /^(вс[её]\s+верно|верно|подтверждаю|подтвердить)[.!]?$/i.test(
    value.trim()
  );
}

function isWholePreviewCancellation(value: string): boolean {
  return /^(отмени(ть)?\s+вс[её]|отмена\s+всего|вс[её]\s+отмени(ть)?)[.!]?$/i.test(
    value.trim()
  );
}
