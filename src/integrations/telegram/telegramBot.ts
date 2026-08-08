import { Bot, InlineKeyboard } from "grammy";
import { createMasterBudgetSaveService } from "../../app/masterBudgetSaveService.js";
import {
  ACCOUNTS,
  CURRENCIES,
  TRANSACTION_CATEGORIES
} from "../../budget/catalog.js";
import { searchSupportedCurrencies } from "../../budget/currencySearch.js";
import {
  calculateBudgetPreviewSummary,
  type BudgetPreviewSummary,
  type DebtPosition
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
  createFileNotionWriteFailureRepository,
  type NotionWriteFailureRepository
} from "../../storage/fileNotionWriteFailureRepository.js";
import {
  createFrankfurterCurrencyConverter,
  type CurrencyConverter
} from "../currency/frankfurterCurrencyConverter.js";
import {
  createOpenAiTransactionParser,
  normalizeParsedBudgetMessage,
  type ParsedBudgetMessageDraft,
  type ParsedDebtOperationDraft,
  type ParsedTransactionDraft,
  type TransactionTextParser
} from "../openai/openAiTransactionParser.js";
import { createNotionMasterBalanceRepository } from "../notion/notionMasterBalanceRepository.js";
import { createNotionMasterDebtRepository } from "../notion/notionMasterDebtRepository.js";
import { createNotionMasterLedgerRepository } from "../notion/notionMasterLedgerRepository.js";
import { createNotionMasterOpeningBalanceRepository } from "../notion/notionMasterOpeningBalanceRepository.js";
import {
  createNotionTelegramDraftRepository,
  type TelegramDraftRepository
} from "../notion/notionTelegramDraftRepository.js";

export type TelegramBot = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

type TelegramBotOptions = {
  parser?: TransactionTextParser;
  currencyConverter?: CurrencyConverter;
  userSettingsRepository?: UserSettingsRepository;
  financialSaveService?: ReturnType<typeof createMasterBudgetSaveService>;
  telegramDraftRepository?: TelegramDraftRepository;
  notionWriteFailureRepository?: NotionWriteFailureRepository;
};

type StoredBudgetDraftPayload = {
  parsed: ParsedBudgetMessageDraft;
  previewMessageIds: number[];
  acceptBalanceMismatch: boolean;
};

type BudgetPreviewFormattingOptions = {
  baseCurrency?: SupportedCurrency;
  summary?: BudgetPreviewSummary;
  summaryUnavailable?: boolean;
  savingEnabled?: boolean;
  calculatedBalance?: number | null;
};

const TELEGRAM_MESSAGE_LIMIT = 4096;
const PREVIEW_WARNING =
  "Пока это только черновик — в Notion ничего не записано.";
const SAVE_ENABLED_WARNING =
  "Это черновик. После ответа «всё верно» я запишу подтверждённые данные в Notion.";
const CURRENCY_SEARCH_PROMPT =
  "Введите код или название валюты отдельным сообщением.";
const currencySearchReplyMarkup = {
  force_reply: true as const,
  selective: true,
  input_field_placeholder: "Например: EUR, евро или донг"
};
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

function createConfiguredFinancialPersistence(config: AppConfig) {
  if (
    !config.notionApiKey ||
    !config.notionBudgetDataSourceId ||
    !config.notionDebtDataSourceId ||
    !config.notionBalanceDataSourceId ||
    !config.notionDraftDataSourceId ||
    !config.notionMasterSettingsDataSourceId ||
    !config.masterTelegramUserId
  ) {
    return null;
  }
  const ledgerRepository = createNotionMasterLedgerRepository({
    apiKey: config.notionApiKey,
    dataSourceId: config.notionBudgetDataSourceId
  });
  const debtRepository = createNotionMasterDebtRepository({
    apiKey: config.notionApiKey,
    dataSourceId: config.notionDebtDataSourceId
  });
  const balanceRepository = createNotionMasterBalanceRepository({
    apiKey: config.notionApiKey,
    dataSourceId: config.notionBalanceDataSourceId
  });
  return {
    financialSaveService: createMasterBudgetSaveService({
      currencyConverter: createFrankfurterCurrencyConverter(),
      ledgerRepository,
      debtRepository,
      balanceRepository,
      openingBalanceRepository: createNotionMasterOpeningBalanceRepository({
        apiKey: config.notionApiKey,
        dataSourceId: config.notionMasterSettingsDataSourceId,
        masterTelegramUserId: config.masterTelegramUserId
      })
    }),
    telegramDraftRepository: createNotionTelegramDraftRepository({
      apiKey: config.notionApiKey,
      dataSourceId: config.notionDraftDataSourceId
    })
  };
}

export function createTelegramBotApp(
  config: AppConfig,
  options: TelegramBotOptions = {}
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
  const configuredPersistence = createConfiguredFinancialPersistence(config);
  const financialSaveService =
    options.financialSaveService ?? configuredPersistence?.financialSaveService;
  const telegramDraftRepository =
    options.telegramDraftRepository ?? configuredPersistence?.telegramDraftRepository;
  if (Boolean(financialSaveService) !== Boolean(telegramDraftRepository)) {
    throw new Error("Telegram financial persistence must configure both save and draft repositories.");
  }
  const savingEnabled = Boolean(financialSaveService && telegramDraftRepository);
  const notionWriteFailureRepository =
    options.notionWriteFailureRepository ??
    createFileNotionWriteFailureRepository(config.failedNotionWriteDirectory);
  const isSavingEnabledFor = (telegramUserId: string) =>
    savingEnabled && telegramUserId === config.masterTelegramUserId;
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
        reply_markup: currencySearchReplyMarkup
      });
      return;
    }

    if (!settings.onboardingHelpShown) {
      await userSettingsRepository.save({
        ...settings,
        onboardingHelpShown: true
      });
      await ctx.reply(formatFirstCurrencySelection(settings.baseCurrency, isSavingEnabledFor(telegramUserId)), {
        parse_mode: "HTML"
      });
      return;
    }

    await ctx.reply(formatWelcomeBack(settings.baseCurrency, isSavingEnabledFor(telegramUserId)), {
      parse_mode: "HTML"
    });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      formatHelpMessage(isSavingEnabledFor(requireTelegramUserId(ctx.from?.id))),
      { parse_mode: "HTML" }
    );
  });

  bot.command("settings", async (ctx) => {
    const telegramUserId = requireTelegramUserId(ctx.from?.id);
    const settings =
      await userSettingsRepository.findByTelegramUserId(telegramUserId);
    await ctx.reply(formatSettingsMessage(settings), {
      parse_mode: "HTML",
      reply_markup: currencySearchReplyMarkup
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
        ? formatFirstCurrencySelection(currency, isSavingEnabledFor(telegramUserId))
        : formatCurrencySelectionUpdated(currency),
      {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] }
      }
    );
  });

  bot.on("message:text", async (ctx) => {
    try {
      const telegramUserId = requireTelegramUserId(ctx.from?.id);
      const financialSavingEnabled = isSavingEnabledFor(telegramUserId);
      const settings =
        await userSettingsRepository.findByTelegramUserId(telegramUserId);
      const currencySearchRequested =
        settings === null ||
        isCurrencySearchReply(ctx.message.reply_to_message);
      if (currencySearchRequested) {
        const matches = searchSupportedCurrencies(ctx.message.text);
        if (matches.length === 1) {
          const currency = matches[0]!;
          const isFirstSelection = settings === null;
          const savedSettings: UserSettings = {
            telegramUserId,
            baseCurrency: currency,
            onboardingHelpShown: settings?.onboardingHelpShown ?? true
          };
          await userSettingsRepository.save(savedSettings);
          await ctx.reply(
            isFirstSelection
              ? formatFirstCurrencySelection(currency, financialSavingEnabled)
              : formatCurrencySelectionUpdated(currency),
            { parse_mode: "HTML" }
          );
          return;
        }

        if (matches.length > 1) {
          await ctx.reply("Нашёл несколько валют. Выберите нужную:", {
            reply_markup: createCurrencySearchKeyboard(matches)
          });
          return;
        }

        await ctx.reply(
          settings
            ? formatCurrencySearchNotFound()
            : `Сначала выберите основную валюту. ${formatCurrencySearchNotFound()}`,
          { reply_markup: currencySearchReplyMarkup }
        );
        return;
      }

      await ctx.replyWithChatAction("typing");
      const repliedPreview = getRepliedPreviewText(ctx.message.reply_to_message);
      if (repliedPreview) {
        const instruction = ctx.message.text.trim();
        const storedDraft = financialSavingEnabled
          ? await telegramDraftRepository!.find(
              String(ctx.chat.id),
              ctx.message.reply_to_message!.message_id
            )
          : null;
        if (financialSavingEnabled && !storedDraft) {
          await ctx.reply(
            "Этот черновик уже закрыт или устарел. Пришлите финансовое сообщение ещё раз."
          );
          return;
        }
        if (storedDraft && Date.parse(storedDraft.expiresAt) <= Date.now()) {
          await telegramDraftRepository!.trash(storedDraft.pageId);
          await ctx.reply(
            "Срок этого черновика истёк. Пришлите финансовое сообщение ещё раз."
          );
          return;
        }
        const storedPayload = storedDraft
          ? deserializeStoredBudgetDraft(storedDraft.serializedDraft)
          : null;

        if (isWholePreviewConfirmation(instruction)) {
          if (financialSavingEnabled && storedDraft && storedPayload) {
            let result;
            try {
              result = await financialSaveService!.save({
                telegramUserId,
                chatId: String(ctx.chat.id),
                sourceMessageId: storedDraft.sourceMessageId,
                baseCurrency: settings.baseCurrency,
                parsed: storedPayload.parsed,
                acceptBalanceMismatch: storedPayload.acceptBalanceMismatch
              });
            } catch (error: unknown) {
              const friendlyError = userFacingSaveError(error);
              console.error(
                "Telegram confirmed budget save failed",
                error instanceof Error ? error.message : "unknown error"
              );
              if (!friendlyError) {
                try {
                  const fallback = await notionWriteFailureRepository.save({
                    telegramUserId,
                    chatId: String(ctx.chat.id),
                    sourceMessageId: storedDraft.sourceMessageId,
                    failedAt: new Date().toISOString(),
                    errorMessage:
                      error instanceof Error ? error.message : "unknown error",
                    normalizedDraft: storedPayload.parsed
                  });
                  console.error(
                    "Normalized Notion write fallback created",
                    JSON.stringify({ path: fallback.path })
                  );
                } catch (fallbackError: unknown) {
                  console.error(
                    "Normalized Notion write fallback failed",
                    fallbackError instanceof Error
                      ? fallbackError.message
                      : "unknown error"
                  );
                }
              }
              await ctx.reply(
                friendlyError ??
                  "Не удалось завершить запись в Notion. Черновик и сообщения сохранены — можно ответить «всё верно» ещё раз после проверки."
              );
              return;
            }
            if (result.status === "balance_mismatch") {
              const warning = formatBalanceMismatch(result);
              const sent = await ctx.reply(warning, previewReplyOptions);
              await telegramDraftRepository!.save({
                telegramUserId,
                chatId: String(ctx.chat.id),
                sourceMessageId: storedDraft.sourceMessageId,
                previewMessageId: sent.message_id,
                serializedDraft: serializeStoredBudgetDraft({
                  ...storedPayload,
                  previewMessageIds: [
                    ...new Set([
                      ...storedPayload.previewMessageIds,
                      sent.message_id
                    ])
                  ],
                  acceptBalanceMismatch: true
                }),
                expiresAt: storedDraft.expiresAt
              });
              await telegramDraftRepository!.trash(storedDraft.pageId);
              return;
            }

            await telegramDraftRepository!.trash(storedDraft.pageId);
            await cleanupSavedTelegramMessages(
              bot,
              ctx.chat.id,
              storedDraft.sourceMessageId,
              storedPayload.previewMessageIds,
              ctx.message.message_id
            );
            await ctx.reply(formatSaveReceipt(result));
            return;
          }
          await ctx.reply(
            "✅ Все пункты проверены. Это preview — в Notion ничего не записано."
          );
          return;
        }

        if (isWholePreviewCancellation(instruction)) {
          if (storedDraft) {
            await telegramDraftRepository!.trash(storedDraft.pageId);
          }
          await ctx.reply(
            "✖️ Весь черновик отменён. В Notion ничего не записано."
          );
          return;
        }

        if (storedPayload?.acceptBalanceMismatch) {
          await ctx.reply(
            "Если операция действительно пропущена, отправьте её отдельным сообщением. Если остаток верный, ответьте «ничего не пропустил»."
          );
          return;
        }

        try {
          const revised = await parser.revise(repliedPreview, instruction);
          const sent = await ctx.reply(
            await formatUserBudgetMessagePreview(
              revised,
              settings.baseCurrency,
              currencyConverter,
              financialSavingEnabled,
              await previewPersistentBalance(
                financialSavingEnabled,
                financialSaveService,
                telegramUserId,
                String(ctx.chat.id),
                storedDraft?.sourceMessageId ?? ctx.message.message_id,
                settings.baseCurrency,
                revised
              )
            ),
            previewReplyOptions
          );
          if (storedDraft && storedPayload) {
            await telegramDraftRepository!.save({
              telegramUserId,
              chatId: String(ctx.chat.id),
              sourceMessageId: storedDraft.sourceMessageId,
              previewMessageId: sent.message_id,
              serializedDraft: serializeStoredBudgetDraft({
                parsed: revised,
                previewMessageIds: [
                  ...new Set([
                    ...storedPayload.previewMessageIds,
                    sent.message_id
                  ])
                ],
                acceptBalanceMismatch: false
              }),
              expiresAt: storedDraft.expiresAt
            });
            await telegramDraftRepository!.trash(storedDraft.pageId);
          }
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
        currencyConverter,
        financialSavingEnabled,
        await previewPersistentBalance(
          financialSavingEnabled,
          financialSaveService,
          telegramUserId,
          String(ctx.chat.id),
          ctx.message.message_id,
          settings.baseCurrency,
          parsed
        )
      );

      const sent = await ctx.reply(preview, previewReplyOptions);
      if (financialSavingEnabled) {
        await telegramDraftRepository!.save({
          telegramUserId,
          chatId: String(ctx.chat.id),
          sourceMessageId: ctx.message.message_id,
          previewMessageId: sent.message_id,
          serializedDraft: serializeStoredBudgetDraft({
            parsed,
            previewMessageIds: [sent.message_id],
            acceptBalanceMismatch: false
          }),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString()
        });
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
  const userSettingsRepository = createConfiguredUserSettingsRepository(config);
  const bot = createTelegramBotApp(config, { userSettingsRepository });
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
  if (
    parsed.transactions.length === 0 &&
    parsed.debtOperations.length === 0 &&
    parsed.balanceObservations.length === 0
  ) {
    const clarificationLines = parsed.ambiguities.map(
      (item) => `• ${escapeTelegramHtml(normalizeText(item))}`
    );

    return [
      "Не нашёл ни одной финансовой операции или наблюдения баланса.",
      clarificationLines.length
        ? `\n<b>Осталось уточнить:</b>\n${clarificationLines.join("\n")}`
        : " Напишите сумму, валюту и назначение точнее.",
      `\n${previewWarning(options)}`
    ].join("");
  }

  const detailed = buildBudgetMessagePreview(parsed, true, options);
  if (telegramRenderedText(detailed).length <= TELEGRAM_MESSAGE_LIMIT) {
    return detailed;
  }

  return limitTelegramMessage(
    buildBudgetMessagePreview(parsed, false, options),
    previewWarning(options)
  );
}

function buildBudgetMessagePreview(
  parsed: ParsedBudgetMessageDraft,
  includeDetails: boolean,
  options: BudgetPreviewFormattingOptions
): string {
  const orderedTransactions = orderTransactionsForPreview(parsed.transactions);
  const sections: string[] = [
    "<b>Вот что я понял из сообщения:</b>"
  ];

  if (orderedTransactions.length) {
    sections.push(
      [
        "<b>Операции:</b>",
        ...orderedTransactions.map((draft, index) =>
          formatCombinedTransaction(draft, index + 1, includeDetails)
        )
      ].join("\n")
    );
  }

  if (parsed.debtOperations.length) {
    sections.push(
      [
        "<b>Долговые операции:</b>",
        ...parsed.debtOperations.map((operation, index) =>
          formatCombinedDebtOperation(operation, index + 1, includeDetails)
        )
      ].join("\n")
    );
  }

  const clarifications = collectClarificationRequests(
    parsed,
    orderedTransactions,
    includeDetails
  );
  if (clarifications.length) {
    sections.push(["<b>Осталось уточнить:</b>", ...clarifications].join("\n"));
  }

  sections.push("<b>Всё совпало?</b> Напишите «всё верно» или просто скажите, что поправить.");

  const summary = formatBudgetPreviewSummary(options);
  if (summary) {
    sections.push(summary);
  }

  sections.push(previewWarning(options));

  return sections.join("\n\n");
}

function orderTransactionsForPreview(
  transactions: ParsedTransactionDraft[]
): ParsedTransactionDraft[] {
  const directionOrder: Record<ParsedTransactionDraft["direction"], number> = {
    income: 0,
    expense: 1,
    transfer: 2
  };

  return transactions
    .map((transaction, originalIndex) => ({ transaction, originalIndex }))
    .sort(
      (left, right) =>
        directionOrder[left.transaction.direction] -
          directionOrder[right.transaction.direction] ||
        left.originalIndex - right.originalIndex
    )
    .map(({ transaction }) => transaction);
}

async function formatUserBudgetMessagePreview(
  parsed: ParsedBudgetMessageDraft,
  baseCurrency: SupportedCurrency,
  currencyConverter: CurrencyConverter,
  savingEnabled = false,
  calculatedBalance: number | null = null
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
    return formatBudgetMessagePreview(parsed, {
      baseCurrency,
      summary,
      savingEnabled,
      calculatedBalance
    });
  } catch (error: unknown) {
    console.error(
      "Telegram preview currency summary failed",
      error instanceof Error ? error.message : "unknown error"
    );
    return formatBudgetMessagePreview(parsed, {
      baseCurrency,
      summaryUnavailable: true,
      savingEnabled,
      calculatedBalance
    });
  }
}

async function previewPersistentBalance(
  enabled: boolean,
  service: ReturnType<typeof createMasterBudgetSaveService> | undefined,
  telegramUserId: string,
  chatId: string,
  sourceMessageId: number,
  baseCurrency: SupportedCurrency,
  parsed: ParsedBudgetMessageDraft
): Promise<number | null> {
  if (!enabled || !service) return null;
  try {
    return await service.previewCurrentBalance({
      telegramUserId,
      chatId,
      sourceMessageId,
      baseCurrency,
      parsed
    });
  } catch (error: unknown) {
    console.error(
      "Telegram persistent balance preview failed",
      error instanceof Error ? error.message : "unknown error"
    );
    return null;
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
    ].join("\n\n");
  }

  const summary = options.summary;
  const sections = [
    heading,
    [
      `<b>Доход:</b> ${boldTelegramHtml(`${formatAmount(summary.income)} ${summary.baseCurrency}`)}`,
      `<b>Расход:</b> ${boldTelegramHtml(`${formatAmount(summary.expense)} ${summary.baseCurrency}`)}`
    ].join("\n")
  ];

  if (summary.debt.owedByUser.length > 0) {
    const hasReduction = summary.debt.owedByUser.some(
      (position) => position.amount < 0
    );
    sections.push(
      [
        `<b>${hasReduction ? "Изменение общего долга" : "Общий долг"}:</b> ${boldTelegramHtml(formatDebtTotals(summary.debt.owedByUser))}`,
        "<b>Кому должен:</b>",
        ...formatDebtPositions(summary.debt.owedByUser)
      ].join("\n")
    );
  }

  if (summary.debt.owedToUser.length > 0) {
    const hasReduction = summary.debt.owedToUser.some(
      (position) => position.amount < 0
    );
    sections.push(
      [
        `<b>${hasReduction ? "Изменение долга мне" : "Всего должны мне"}:</b> ${boldTelegramHtml(formatDebtTotals(summary.debt.owedToUser))}`,
        "<b>Кто должен:</b>",
        ...formatDebtPositions(summary.debt.owedToUser)
      ].join("\n")
    );
  }

  if (summary.incompleteOperationCount > 0) {
    sections.push(
      `Итог пока считает только заполненные операции: ${summary.incompleteOperationCount} ${pluralizeOperation(summary.incompleteOperationCount)} нужно уточнить.`
    );
  }

  if (summary.observedBalances.length === 0) {
    sections.push(
      options.calculatedBalance === null ||
        options.calculatedBalance === undefined
        ? "<b>Общий остаток:</b> в этом сообщении не указан."
        : `<b>Общий остаток:</b> ${boldTelegramHtml(`${formatAmount(options.calculatedBalance)} ${summary.baseCurrency}`)}`
    );
  } else {
    const totalObservedBalance = summary.observedBalances.reduce(
      (total, balance) => total + balance.amount,
      0
    );
    sections.push(
      `<b>Общий остаток:</b> ${boldTelegramHtml(`${formatAmount(totalObservedBalance)} ${summary.baseCurrency}`)}`
    );
  }

  return sections.join("\n\n");
}

function createCurrencySearchKeyboard(
  currencies: readonly SupportedCurrency[]
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const [index, currency] of currencies.entries()) {
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
    CURRENCY_SEARCH_PROMPT,
    "Можно написать код или привычное название: EUR, евро, USD, доллар, VND, донг.",
    "",
    "Выбор всегда можно изменить в разделе /settings."
  ].join("\n");
}

function formatFirstCurrencySelection(
  currency: SupportedCurrency,
  savingEnabled = false
): string {
  return [
    `<b>Готово — основная валюта ${currency}.</b>`,
    "",
    "Теперь напишите одну или несколько операций обычным сообщением. Например:",
    "Получил 500 USD за фриланс, перевёл 200 USD с Crypto на Вьетнамский счёт и потратил 120к VND на кофе по QR.",
    "",
    "Я покажу понятный черновик. Если всё совпало, ответьте «всё верно». Если нет, можно написать: «3: валюта USD», «для всех счёт Карта» или «отмени 4».",
    "Слово «тоже» повторяет последнее исправление для следующего пункта. Для исправления долга напишите, например: «долг 2: счёт Карта». Полная подсказка всегда есть в /help.",
    "",
    savingEnabled ? SAVE_ENABLED_WARNING : PREVIEW_WARNING
  ].join("\n");
}

function formatWelcomeBack(
  currency: SupportedCurrency,
  savingEnabled = false
): string {
  return [
    "С возвращением! Напишите доходы, расходы, переводы или долговые операции обычным сообщением.",
    `Общий итог покажу в ${currency}. Изменить валюту можно в /settings.`,
    savingEnabled ? SAVE_ENABLED_WARNING : PREVIEW_WARNING
  ].join("\n");
}

function formatSettingsMessage(settings: UserSettings | null): string {
  return [
    "<b>Настройки</b>",
    settings
      ? `Основная валюта: <b>${settings.baseCurrency}</b>`
      : "Основная валюта ещё не выбрана.",
    "В ней я показываю доход, расход и остаток.",
    CURRENCY_SEARCH_PROMPT
  ].join("\n");
}

function formatCurrencySelectionUpdated(currency: SupportedCurrency): string {
  return [
    `<b>Готово. Основная валюта: ${currency}.</b>`,
    "Если захотите изменить её снова, откройте /settings."
  ].join("\n");
}

function formatCurrencySearchNotFound(): string {
  return "Не нашёл такую валюту. Напишите отдельно код или название: например, EUR, евро, USD или донг.";
}

function serializeStoredBudgetDraft(payload: StoredBudgetDraftPayload): string {
  return JSON.stringify(payload);
}

function deserializeStoredBudgetDraft(value: string): StoredBudgetDraftPayload {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (!Array.isArray(parsed.previewMessageIds)) {
    throw new Error("Stored Telegram draft has invalid preview message IDs.");
  }
  const previewMessageIds = parsed.previewMessageIds.map((item) => {
    if (!Number.isSafeInteger(item) || Number(item) < 0) {
      throw new Error("Stored Telegram draft has an invalid preview message ID.");
    }
    return Number(item);
  });
  return {
    parsed: normalizeParsedBudgetMessage(parsed.parsed),
    previewMessageIds,
    acceptBalanceMismatch: parsed.acceptBalanceMismatch === true
  };
}

function formatBalanceMismatch(result: {
  observedBalance: number;
  calculatedBalance: number;
  difference: number;
  tolerance: number;
}): string {
  return [
    "<b>Остаток не совпал с расчётом.</b>",
    `По операциям: <b>${formatAmount(result.calculatedBalance)} EUR</b>.`,
    `В сообщении: <b>${formatAmount(result.observedBalance)} EUR</b>.`,
    `Разница: <b>${formatAmount(Math.abs(result.difference))} EUR</b>, допустимая погрешность: <b>${formatAmount(result.tolerance)} EUR</b>.`,
    "Возможно, какая-то операция не внесена. Пришлите её отдельным сообщением или ответьте «ничего не пропустил», чтобы принять ваш остаток."
  ].join("\n\n");
}

function formatSaveReceipt(result: {
  openingBalanceCreated: boolean;
  transactionCount: number;
  debtOperationCount: number;
  balanceObservationCount: number;
  historicalOperationCount: number;
  currentBalance: number;
  baseCurrency: string;
}): string {
  const savedCount =
    result.transactionCount +
    result.debtOperationCount +
    result.balanceObservationCount;
  const lines = [
    result.openingBalanceCreated
      ? "✅ Стартовый остаток записан в Notion."
      : `✅ Записано в Notion: ${savedCount} ${pluralizeOperation(savedCount)}.`,
    `Общий остаток: ${formatAmount(result.currentBalance)} ${result.baseCurrency}.`
  ];
  if (result.historicalOperationCount > 0) {
    lines.push(
      `Исторических операций до якоря: ${result.historicalOperationCount}. Они учтены в аналитике и не изменили текущий остаток.`
    );
  }
  return lines.join("\n");
}

function userFacingSaveError(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (
    /^(Сначала |Реальная запись|В черновике|Дата общего остатка|Операция попадает|Этот черновик старше)/.test(
      error.message
    )
  ) {
    return `${error.message} Ничего не записано.`;
  }
  return null;
}

async function cleanupSavedTelegramMessages(
  bot: Bot,
  chatId: number,
  sourceMessageId: number,
  previewMessageIds: number[],
  confirmationMessageId: number
): Promise<void> {
  const messageIds = [
    sourceMessageId,
    ...previewMessageIds,
    confirmationMessageId
  ];
  for (const messageId of new Set(messageIds)) {
    try {
      await bot.api.deleteMessage(chatId, messageId);
    } catch (error: unknown) {
      console.error(
        "Telegram post-save cleanup failed",
        JSON.stringify({
          chatId: String(chatId),
          messageId,
          error: error instanceof Error ? error.message : "unknown error"
        })
      );
    }
  }
}

function formatHelpMessage(savingEnabled = false): string {
  return [
    "<b>Как со мной работать</b>",
    "Напишите одну или несколько операций обычным сообщением. Для перевода назовите оба счёта.",
    "",
    "Примеры:",
    "• Вчера продукты 350к VND по QR",
    "• Получил 500 USD за фриланс",
    "• Перевёл 177 USD с Crypto на Вьетнамский счёт",
    "• Взял в долг у Пети 100 USD на карту",
    "• Вернул Пете 30 USD долга с карты",
    "• Дал Ане в долг 50 EUR наличными",
    "• Аня вернула 20 EUR долга наличными",
    "",
    "После черновика можно ответить «всё верно» или написать исправление: «3: валюта USD», «долг 2: счёт Карта», «для всех счёт Карта», «отмени 4». Обычный номер относится к разделу «Операции», а слово «долг» — к номеру в разделе «Долговые операции». Слово «тоже» повторяет последнее исправление для следующего пункта.",
    "Основная валюта ищется по коду или названию через /settings.",
    "Доходы и расходы на диаграммах открываются через /reports.",
    "",
    savingEnabled ? SAVE_ENABLED_WARNING : PREVIEW_WARNING
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

function formatCombinedDebtOperation(
  operation: ParsedDebtOperationDraft,
  position: number,
  includeDetails: boolean
): string {
  const counterparty = escapeTelegramHtml(
    operation.counterparty ?? "человек или организация не указаны"
  );
  const action = {
    borrow: `Взял в долг — ${counterparty}`,
    repay_borrowed: `Вернул долг — ${counterparty}`,
    lend: `Дал в долг — ${counterparty}`,
    collect: `Мне вернули долг — ${counterparty}`
  }[operation.action];
  const description = includeDetails
    ? normalizeText(operation.description)
    : truncateText(operation.description, 36);
  const fields = [
    `${position}. ${action} — ${boldTelegramHtml(formatDraftAmount(operation.amount, operation.currency))}`,
    formatIsoDate(operation.occurredOn),
    escapeTelegramHtml(operation.account ?? "счёт не указан"),
    `«${escapeTelegramHtml(description)}»`
  ];

  if (includeDetails && operation.note) {
    fields.push(`комментарий: ${escapeTelegramHtml(normalizeText(operation.note))}`);
  }
  if (operation.confidence < 0.6) {
    fields.push("низкая уверенность");
  }
  return fields.join(" · ");
}

function formatDebtTotals(positions: DebtPosition[]): string {
  const totals = new Map<string, number>();
  for (const position of positions) {
    totals.set(
      position.currency,
      (totals.get(position.currency) ?? 0) + position.amount
    );
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => `${formatAmount(amount)} ${currency}`)
    .join(" · ");
}

function formatDebtPositions(positions: DebtPosition[]): string[] {
  return positions.map(
    (position) =>
      `• ${escapeTelegramHtml(position.counterparty ?? "Не указано")} — ${boldTelegramHtml(`${formatAmount(position.amount)} ${position.currency}`)}`
  );
}

function collectClarificationRequests(
  parsed: ParsedBudgetMessageDraft,
  orderedTransactions: ParsedTransactionDraft[],
  includeDetails: boolean
): string[] {
  const requests: string[] = [];
  const messageMissingFields = new Set<MissingField>();

  for (const [index, draft] of orderedTransactions.entries()) {
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

  for (const [index, operation] of parsed.debtOperations.entries()) {
    const missingFields: MissingField[] = [];
    if (operation.amount === null) {
      missingFields.push("сумму");
    }
    if (operation.currency === null) {
      missingFields.push("валюту");
    }
    if (operation.counterparty === null) {
      missingFields.push("человека или организацию");
    }
    if (operation.account === null) {
      missingFields.push("счёт");
    }
    for (const field of missingFields) {
      messageMissingFields.add(field);
    }

    if (missingFields.length) {
      requests.push(
        `• Долговая операция ${index + 1} «${escapeTelegramHtml(normalizeText(operation.description))}» — укажите ${joinRussianList(missingFields)}.`
      );
    }

    if (includeDetails) {
      for (const ambiguity of operation.ambiguities.filter(
        (item) => !ambiguityConcernsMissingField(item, missingFields)
      )) {
        requests.push(
          `• Долговая операция ${index + 1} — ${escapeTelegramHtml(normalizeText(ambiguity))}`
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
  | "человека или организацию"
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
    "человека или организацию": /челов|организац|контрагент|кому|у кого|кто|person|counterparty/i,
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

function limitTelegramMessage(value: string, warning = PREVIEW_WARNING): string {
  const rendered = telegramRenderedText(value);
  if (rendered.length <= TELEGRAM_MESSAGE_LIMIT) {
    return value;
  }

  const suffix = `\n\n… Часть длинных деталей сокращена.\n${warning}`;
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
    replyToMessage.text.includes(SAVE_ENABLED_WARNING)
    ? replyToMessage.text
    : null;
}

function previewWarning(options: BudgetPreviewFormattingOptions): string {
  return options.savingEnabled ? SAVE_ENABLED_WARNING : PREVIEW_WARNING;
}

function isCurrencySearchReply(
  replyToMessage:
    | { text?: string; from?: { is_bot: boolean } }
    | undefined
): boolean {
  return Boolean(
    replyToMessage?.from?.is_bot &&
      replyToMessage.text?.includes(CURRENCY_SEARCH_PROMPT)
  );
}

function isWholePreviewConfirmation(value: string): boolean {
  return /^(вс[её]\s+верно|верно|подтверждаю|подтвердить|ничего\s+не\s+(?:пропустил|забыл))[.!]?$/i.test(
    value.trim()
  );
}

function isWholePreviewCancellation(value: string): boolean {
  return /^(отмени(ть)?\s+вс[её]|отмена\s+всего|вс[её]\s+отмени(ть)?)[.!]?$/i.test(
    value.trim()
  );
}
