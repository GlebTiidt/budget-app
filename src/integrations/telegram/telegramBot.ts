import { Bot, InlineKeyboard } from "grammy";
import {
  ACCOUNTS,
  CURRENCIES,
  TRANSACTION_CATEGORIES
} from "../../budget/catalog.js";
import {
  calculateBudgetPreviewSummary,
  type BudgetPreviewSummary
} from "../../budget/previewSummary.js";
import {
  isSupportedCurrency,
  type SupportedCurrency,
  type UserSettings,
  type UserSettingsRepository
} from "../../budget/userSettings.js";
import type { AppConfig } from "../../config/loadConfig.js";
import { createConfiguredUserSettingsRepository } from "../../storage/configuredUserSettingsRepository.js";
import {
  createFrankfurterCurrencyConverter,
  type CurrencyConverter
} from "../currency/frankfurterCurrencyConverter.js";
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
  currencyConverter?: CurrencyConverter;
  userSettingsRepository?: UserSettingsRepository;
};

type BudgetPreviewFormattingOptions = {
  baseCurrency?: SupportedCurrency;
  summary?: BudgetPreviewSummary;
  summaryUnavailable?: boolean;
};

type PreviewAction = "confirm" | "correct" | "cancel";
type PreviewItemKind = "transaction" | "balance";

const TELEGRAM_MESSAGE_LIMIT = 4096;
const PREVIEW_WARNING =
  "Пока это только черновик — в Notion ничего не записано.";
const LEGACY_PREVIEW_WARNING = "Preview: в Notion ничего не записано.";
const previewReplyMarkup = {
  force_reply: true as const,
  selective: true,
  input_field_placeholder: "Например: для всех счёт Карта"
};
const previewReplyOptions = {
  parse_mode: "HTML" as const,
  reply_markup: previewReplyMarkup
};
const telegramCommands = [
  { command: "start", description: "Начать работу" },
  { command: "settings", description: "Настройки" },
  { command: "reports", description: "Доходы и расходы" },
  { command: "help", description: "Как пользоваться ботом" }
];

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
  const currencyConverter =
    options.currencyConverter ?? createFrankfurterCurrencyConverter();
  const userSettingsRepository =
    options.userSettingsRepository ??
    createConfiguredUserSettingsRepository(config);
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
    const telegramUserId = requireTelegramUserId(ctx.from?.id);
    const settings =
      await userSettingsRepository.findByTelegramUserId(telegramUserId);

    if (!settings) {
      await ctx.reply(formatCurrencyOnboarding(), {
        parse_mode: "HTML",
        reply_markup: createCurrencyKeyboard()
      });
      return;
    }

    if (!settings.onboardingHelpShown) {
      await userSettingsRepository.save({
        ...settings,
        onboardingHelpShown: true
      });
      await ctx.reply(formatFirstCurrencySelection(settings.baseCurrency), {
        parse_mode: "HTML"
      });
      return;
    }

    await ctx.reply(formatWelcomeBack(settings.baseCurrency), {
      parse_mode: "HTML"
    });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(formatHelpMessage(), { parse_mode: "HTML" });
  });

  bot.command("settings", async (ctx) => {
    const telegramUserId = requireTelegramUserId(ctx.from?.id);
    const settings =
      await userSettingsRepository.findByTelegramUserId(telegramUserId);
    await ctx.reply(formatSettingsMessage(settings), {
      parse_mode: "HTML",
      reply_markup: createCurrencyKeyboard()
    });
  });

  bot.command("reports", async (ctx) => {
    if (!config.reportsWebAppUrl) {
      await ctx.reply(
        "Диаграммы уже подготовлены, но ссылка на них ещё не подключена к этому серверу."
      );
      return;
    }

    await ctx.reply("Я собрал доходы и расходы по месяцам. Откройте отчёт и выберите месяц и вид диаграммы, который сейчас удобнее.", {
      reply_markup: new InlineKeyboard().webApp(
        "Открыть диаграммы",
        config.reportsWebAppUrl
      )
    });
  });

  bot.callbackQuery(/^settings:currency:([A-Z]{3})$/, async (ctx) => {
    const currency = ctx.match[1] ?? "";
    if (!isSupportedCurrency(currency)) {
      await ctx.answerCallbackQuery({ text: "Эта валюта пока не поддерживается." });
      return;
    }

    const telegramUserId = requireTelegramUserId(ctx.from?.id);
    const previous =
      await userSettingsRepository.findByTelegramUserId(telegramUserId);
    const isFirstSelection = previous === null;
    await userSettingsRepository.save({
      telegramUserId,
      baseCurrency: currency,
      onboardingHelpShown: previous?.onboardingHelpShown ?? true
    });
    await ctx.answerCallbackQuery({ text: `Основная валюта: ${currency}` });
    await ctx.editMessageText(
      isFirstSelection
        ? formatFirstCurrencySelection(currency)
        : formatSettingsMessage({
            telegramUserId,
            baseCurrency: currency,
            onboardingHelpShown: previous.onboardingHelpShown
          }),
      {
        parse_mode: "HTML",
        reply_markup: createCurrencyKeyboard()
      }
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
    try {
      const telegramUserId = requireTelegramUserId(ctx.from?.id);
      const settings =
        await userSettingsRepository.findByTelegramUserId(telegramUserId);
      if (!settings) {
        await ctx.reply(
          "Сначала выберите основную валюту — в ней я буду показывать общий итог.",
          { reply_markup: createCurrencyKeyboard() }
        );
        return;
      }

      await ctx.replyWithChatAction("typing");
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
          await ctx.reply(
            await formatUserBudgetMessagePreview(
              revised,
              settings.baseCurrency,
              currencyConverter
            ),
            previewReplyOptions
          );
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
      const preview = await formatUserBudgetMessagePreview(
        parsed,
        settings.baseCurrency,
        currencyConverter
      );

      await ctx.reply(preview, previewReplyOptions);
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
  const userSettingsRepository = createConfiguredUserSettingsRepository(config);
  const bot = createTelegramPreviewBot(config, { userSettingsRepository });
  let stopped = false;

  return {
    async start() {
      await bot.api.setMyCommands(telegramCommands);
      await bot.start({
        allowed_updates: ["message", "callback_query"]
      });
    },
    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      await bot.stop();
      userSettingsRepository.close();
    }
  };
}

export function isTelegramUserAllowed(
  userId: number | undefined,
  allowedUserIds: string[]
): boolean {
  return userId !== undefined && allowedUserIds.includes(String(userId));
}

export function formatBudgetMessagePreview(
  parsed: ParsedBudgetMessageDraft,
  options: BudgetPreviewFormattingOptions = {}
): string {
  if (parsed.transactions.length === 0 && parsed.balanceObservations.length === 0) {
    const clarificationLines = parsed.ambiguities.map(
      (item) => `• ${escapeTelegramHtml(normalizeText(item))}`
    );

    return [
      "Не нашёл ни одной финансовой операции или наблюдения баланса.",
      clarificationLines.length
        ? `\n<b>Осталось уточнить:</b>\n${clarificationLines.join("\n")}`
        : " Напишите сумму, валюту и назначение точнее.",
      `\n${PREVIEW_WARNING}`
    ].join("");
  }

  const detailed = buildBudgetMessagePreview(parsed, true, options);
  if (telegramRenderedText(detailed).length <= TELEGRAM_MESSAGE_LIMIT) {
    return detailed;
  }

  return limitTelegramMessage(buildBudgetMessagePreview(parsed, false, options));
}

function buildBudgetMessagePreview(
  parsed: ParsedBudgetMessageDraft,
  includeDetails: boolean,
  options: BudgetPreviewFormattingOptions
): string {
  const sections: string[] = [
    "<b>Вот что я понял из сообщения:</b>"
  ];

  if (parsed.transactions.length) {
    sections.push(
      [
        "<b>Операции:</b>",
        ...parsed.transactions.map((draft, index) =>
          formatCombinedTransaction(draft, index + 1, includeDetails)
        )
      ].join("\n")
    );
  }

  if (parsed.balanceObservations.length) {
    sections.push(
      [
        "<b>Ещё вижу остаток на счёте.</b> Держу его отдельно, чтобы не считать доходом или расходом:",
        ...parsed.balanceObservations.map((observation, index) =>
          formatCombinedBalanceObservation(observation, index + 1)
        )
      ].join("\n")
    );
  }

  const clarifications = collectClarificationRequests(parsed, includeDetails);
  if (clarifications.length) {
    sections.push(["<b>Осталось уточнить:</b>", ...clarifications].join("\n"));
  }

  sections.push("<b>Всё совпало?</b> Напишите «всё верно» или просто скажите, что поправить.");

  const summary = formatBudgetPreviewSummary(options);
  if (summary) {
    sections.push(summary);
  }

  sections.push(PREVIEW_WARNING);

  return sections.join("\n\n");
}

async function formatUserBudgetMessagePreview(
  parsed: ParsedBudgetMessageDraft,
  baseCurrency: SupportedCurrency,
  currencyConverter: CurrencyConverter
): Promise<string> {
  try {
    const summary = await calculateBudgetPreviewSummary(
      parsed,
      baseCurrency,
      async (input) =>
        (
          await currencyConverter.convert({
            amount: input.amount,
            from: input.from,
            to: input.to,
            occurredOn: input.occurredOn
          })
        ).convertedAmount
    );
    return formatBudgetMessagePreview(parsed, { baseCurrency, summary });
  } catch (error: unknown) {
    console.error(
      "Telegram preview currency summary failed",
      error instanceof Error ? error.message : "unknown error"
    );
    return formatBudgetMessagePreview(parsed, {
      baseCurrency,
      summaryUnavailable: true
    });
  }
}

function formatBudgetPreviewSummary(
  options: BudgetPreviewFormattingOptions
): string | null {
  if (!options.baseCurrency) {
    return null;
  }

  const heading = `<b>Итог этого сообщения в ${options.baseCurrency}:</b>`;
  if (!options.summary || options.summaryUnavailable) {
    return [
      heading,
      `Сейчас не получилось пересчитать суммы в ${options.baseCurrency}. Попробуйте ещё раз чуть позже.`
    ].join("\n");
  }

  const summary = options.summary;
  const lines = [
    heading,
    `<b>Доход:</b> ${boldTelegramHtml(`${formatAmount(summary.income)} ${summary.baseCurrency}`)}`,
    `<b>Расход:</b> ${boldTelegramHtml(`${formatAmount(summary.expense)} ${summary.baseCurrency}`)}`
  ];

  if (summary.observedBalances.length === 0) {
    lines.push("<b>Остаток:</b> в этом сообщении не указан.");
  } else {
    for (const balance of summary.observedBalances) {
      const account = balance.account
        ? ` на «${escapeTelegramHtml(balance.account)}»`
        : "";
      lines.push(
        `<b>Остаток${account}:</b> ${boldTelegramHtml(`${formatAmount(balance.amount)} ${summary.baseCurrency}`)}`
      );
    }
  }

  if (summary.incompleteOperationCount > 0) {
    lines.push(
      `Итог пока считает только заполненные операции: ${summary.incompleteOperationCount} ${pluralizeOperation(summary.incompleteOperationCount)} нужно уточнить.`
    );
  }

  return lines.join("\n");
}

function createCurrencyKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const [index, currency] of CURRENCIES.entries()) {
    keyboard.text(currency, `settings:currency:${currency}`);
    if ((index + 1) % 3 === 0) {
      keyboard.row();
    }
  }
  return keyboard;
}

function formatCurrencyOnboarding(): string {
  return [
    "<b>Привет! Давайте сначала выберем основную валюту.</b>",
    "В ней я буду показывать общий доход, расход и остаток. Сами операции по-прежнему можно писать в любой поддерживаемой валюте.",
    "",
    "Выбор всегда можно изменить в разделе /settings."
  ].join("\n");
}

function formatFirstCurrencySelection(currency: SupportedCurrency): string {
  return [
    `<b>Готово — основная валюта ${currency}.</b>`,
    "",
    "Теперь напишите одну или несколько операций обычным сообщением. Например:",
    "Получил 500 USD за фриланс, перевёл 200 USD с Crypto на Вьетнамский счёт и потратил 120к VND на кофе по QR.",
    "",
    "Я покажу понятный черновик. Если всё совпало, ответьте «всё верно». Если нет, можно написать: «3: валюта USD», «для всех счёт Карта» или «отмени 4».",
    "Слово «тоже» повторяет последнее исправление для следующего пункта, а Б1, Б2 — это указанные остатки на счетах. Полная подсказка всегда есть в /help.",
    "",
    PREVIEW_WARNING
  ].join("\n");
}

function formatWelcomeBack(currency: SupportedCurrency): string {
  return [
    "С возвращением! Напишите доходы, расходы или переводы обычным сообщением.",
    `Общий итог покажу в ${currency}. Изменить валюту можно в /settings.`,
    PREVIEW_WARNING
  ].join("\n");
}

function formatSettingsMessage(settings: UserSettings | null): string {
  return [
    "<b>Настройки</b>",
    settings
      ? `Основная валюта: <b>${settings.baseCurrency}</b>`
      : "Основная валюта ещё не выбрана.",
    "В ней я показываю доход, расход и остаток. Выберите валюту ниже:"
  ].join("\n");
}

function formatHelpMessage(): string {
  return [
    "<b>Как со мной работать</b>",
    "Напишите одну или несколько операций обычным сообщением. Для перевода назовите оба счёта.",
    "",
    "Примеры:",
    "• Вчера продукты 350к VND по QR",
    "• Получил 500 USD за фриланс",
    "• Перевёл 177 USD с Crypto на Вьетнамский счёт",
    "",
    "После черновика можно ответить «всё верно» или написать исправление: «3: валюта USD», «для всех счёт Карта», «отмени 4». Слово «тоже» повторяет последнее исправление для следующего пункта, а Б1, Б2 — это указанные остатки на счетах.",
    "Основная валюта меняется в /settings.",
    "Доходы и расходы на диаграммах открываются через /reports.",
    "",
    PREVIEW_WARNING
  ].join("\n");
}

function requireTelegramUserId(userId: number | undefined): string {
  if (userId === undefined) {
    throw new Error("Telegram user ID is missing.");
  }
  return String(userId);
}

function pluralizeOperation(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) {
    return "операций";
  }
  if (last === 1) {
    return "операцию";
  }
  if (last >= 2 && last <= 4) {
    return "операции";
  }
  return "операций";
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
    `${position}. ${direction} — ${boldTelegramHtml(formatDraftAmount(draft.amount, draft.currency))}`,
    formatIsoDate(draft.occurredOn)
  ];

  if (draft.direction === "transfer") {
    fields.push(
      `${escapeTelegramHtml(draft.account ?? "счёт-источник не указан")} → ${escapeTelegramHtml(draft.destinationAccount ?? "счёт-получатель не указан")}`
    );
  } else {
    fields.push(boldTelegramHtml(draft.category ?? "категория не указана"));
    fields.push(escapeTelegramHtml(draft.account ?? "счёт не указан"));
  }

  const description = includeDetails
    ? normalizeText(draft.description)
    : truncateText(draft.description, 36);
  fields.push(
    `«${escapeTelegramHtml(description)}»`
  );

  if (includeDetails && draft.note) {
    fields.push(`комментарий: ${escapeTelegramHtml(normalizeText(draft.note))}`);
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
  const amount = `${formatAmount(observation.amount)} ${observation.currency}`;
  const date = formatIsoDate(observation.occurredOn);
  const sentence = observation.account
    ? `Б${position}. На счёте «${escapeTelegramHtml(observation.account)}» осталось ${boldTelegramHtml(amount)} на ${date}.`
    : `Б${position}. Остаток ${boldTelegramHtml(amount)} на ${date}; счёт пока не указан.`;

  if (observation.confidence < 0.6) {
    return `${sentence} Тут я не до конца уверен.`;
  }

  return sentence;
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
      const description = includeDetails
        ? normalizeText(draft.description)
        : truncateText(draft.description, 48);
      requests.push(
        `• Транзакция ${index + 1} «${escapeTelegramHtml(description)}» — укажите ${joinRussianList(missingFields)}.`
      );
    }

    if (includeDetails) {
      for (const ambiguity of draft.ambiguities.filter(
        (item) => !ambiguityConcernsMissingField(item, missingFields)
      )) {
        requests.push(
          `• Транзакция ${index + 1} «${escapeTelegramHtml(normalizeText(draft.description))}» — ${escapeTelegramHtml(normalizeText(ambiguity))}`
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
          `• Наблюдение баланса Б${index + 1} — ${escapeTelegramHtml(normalizeText(ambiguity))}`
        );
      }
    }
  }

  if (includeDetails) {
    for (const ambiguity of parsed.ambiguities.filter(
      (item) =>
        !ambiguityConcernsMissingField(item, [...messageMissingFields])
    )) {
      requests.push(
        `• По всему сообщению — ${escapeTelegramHtml(normalizeText(ambiguity))}`
      );
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
  const rendered = telegramRenderedText(value);
  if (rendered.length <= TELEGRAM_MESSAGE_LIMIT) {
    return value;
  }

  const suffix = `\n\n… Часть длинных деталей сокращена.\n${PREVIEW_WARNING}`;
  return `${rendered.slice(0, TELEGRAM_MESSAGE_LIMIT - suffix.length).trimEnd()}${suffix}`;
}

function boldTelegramHtml(value: string): string {
  return `<b>${escapeTelegramHtml(value)}</b>`;
}

function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function telegramRenderedText(value: string): string {
  return value
    .replace(/<\/?b>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function getRepliedPreviewText(
  replyToMessage:
    | { text?: string; from?: { is_bot: boolean } }
    | undefined
): string | null {
  if (!replyToMessage?.from?.is_bot || !replyToMessage.text) {
    return null;
  }
  return replyToMessage.text.includes(PREVIEW_WARNING) ||
    replyToMessage.text.includes(LEGACY_PREVIEW_WARNING)
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
