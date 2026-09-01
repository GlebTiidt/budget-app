import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../../src/config/loadConfig.js";
import type {
  UserSettings,
  UserSettingsRepository
} from "../../../src/budget/userSettings.js";
import type { CurrencyConverter } from "../../../src/integrations/currency/frankfurterCurrencyConverter.js";
import type {
  StoredTelegramDraft,
  TelegramDraftRepository
} from "../../../src/integrations/notion/notionTelegramDraftRepository.js";
import type {
  ParsedBudgetMessageDraft,
  ParsedDebtOperationDraft,
  ParsedTransactionDraft,
  TransactionTextParser
} from "../../../src/integrations/openai/openAiTransactionParser.js";
import {
  createTelegramBotApp,
  formatBudgetMessagePreview,
  isTelegramUserAllowed
} from "../../../src/integrations/telegram/telegramBot.js";

test("allows only configured Telegram users", () => {
  assert.equal(isTelegramUserAllowed(100001, ["100001"]), true);
  assert.equal(isTelegramUserAllowed(123, ["100001"]), false);
  assert.equal(isTelegramUserAllowed(undefined, ["100001"]), false);
});

test("formats income before expenses while keeping each group stable", () => {
  const preview = formatBudgetMessagePreview({
    transactions: [
      {
        amount: 120_000,
        currency: "VND",
        direction: "expense",
        occurredOn: "2026-08-04",
        category: "Кофешоп",
        account: "Вьетнамский счёт",
        destinationAccount: null,
        description: "Кофе",
        note: null,
        confidence: 0.99,
        ambiguities: []
      },
      {
        ...createDraft("transfer"),
        amount: 200,
        account: "Карта",
        destinationAccount: "Сбережения",
        category: null,
        description: "В сбережения"
      },
      {
        ...createDraft("expense"),
        amount: 70,
        description: "Второй расход"
      },
      createDraft("income")
    ],
    debtOperations: [createDebtOperation("borrow", "Марина")],
    balanceObservations: [
      {
        amount: 20_000,
        currency: "VND",
        occurredOn: "2026-08-04",
        account: "Вьетнамский счёт",
        confidence: 0.9,
        ambiguities: []
      }
    ],
    ambiguities: []
  });

  assert.match(preview, /<b>Вот что я понял из сообщения:<\/b>/);
  assert.match(preview, /<b>Операции:<\/b>/);
  assert.match(preview, /1\. Доход — <b>50 USD<\/b>/);
  assert.match(preview, /2\. Расход — <b>120[  ]000 VND<\/b>/);
  assert.match(preview, /3\. Расход — <b>70 USD<\/b>/);
  assert.match(preview, /4\. Перевод — <b>200 USD<\/b>/);
  assert.match(preview, /<b>Долговые операции:<\/b>\n1\. Взял в долг — Марина/);
  assert.ok(preview.indexOf("2. Расход") < preview.indexOf("3. Расход"));
  assert.ok(preview.indexOf("3. Расход") < preview.indexOf("4. Перевод"));
  assert.ok(preview.indexOf("4. Перевод") < preview.indexOf("1. Взял в долг"));
  assert.match(preview, /<b>Кофешоп<\/b>/);
  assert.doesNotMatch(preview, /Б1\.|Ещё вижу остаток|Держу его отдельно/);
  assert.match(
    preview,
    /<b>Сначала уточним эти пункты\.<\/b>/
  );
  assert.doesNotMatch(preview, /для всех счёт Вьетнамский счёт/);
  assert.match(preview, /в Notion ничего не записано/);
});

test("asks numbered follow-up questions for every missing field", () => {
  const preview = formatBudgetMessagePreview({
    transactions: [
      {
        amount: 50,
        currency: null,
        direction: "expense",
        occurredOn: "2026-08-04",
        category: null,
        account: null,
        destinationAccount: null,
        description: "Покупка",
        note: null,
        confidence: 0.4,
        ambiguities: [
          "Не указана валюта",
          "Указан перевод через криптокошелёк, но счёт не определён"
        ]
      },
      createDraft("income")
    ],
    debtOperations: [],
    balanceObservations: [
      {
        amount: 20_000,
        currency: "VND",
        occurredOn: "2026-08-04",
        account: null,
        confidence: 0.7,
        ambiguities: ["Не указан счёт"]
      }
    ],
    ambiguities: ["Для транзакции 1 счёт не определён однозначно"]
  });

  assert.match(preview, /1\. Доход — <b>50 USD<\/b>/);
  assert.match(preview, /2\. Расход — <b>50, валюта не указана<\/b>/);
  assert.match(preview, /низкая уверенность/);
  assert.match(
    preview,
    /Транзакция 2 «Покупка» — укажите валюту, категорию и счёт\./
  );
  assert.doesNotMatch(preview, /Наблюдение баланса|Б1/);
  assert.doesNotMatch(preview, /криптокошелёк/);
  assert.doesNotMatch(preview, /не определён однозначно/);
});

test("formats a personal transfer as a complete account route", () => {
  const preview = formatBudgetMessagePreview({
    transactions: [
      {
        ...createDraft("transfer"),
        amount: 177,
        account: "Crypto",
        destinationAccount: "Вьетнамский счёт",
        category: null,
        description: "Перевод аванса"
      },
      {
        ...createDraft("transfer"),
        account: "Crypto",
        destinationAccount: null,
        category: null,
        description: "Перевод без получателя"
      }
    ],
    debtOperations: [],
    balanceObservations: [],
    ambiguities: []
  });

  assert.match(
    preview,
    /1\. Перевод — <b>177 USD<\/b>.*Crypto → Вьетнамский счёт/
  );
  assert.match(
    preview,
    /Транзакция 2 «Перевод без получателя» — укажите счёт-получатель\./
  );
});

test("shows debt operations separately and puts total balance last", () => {
  const preview = formatBudgetMessagePreview(
    {
      transactions: [],
      debtOperations: [
        createDebtOperation("borrow", "Петя"),
        createDebtOperation("repay_borrowed", "Петя"),
        createDebtOperation("lend", "Аня"),
        createDebtOperation("collect", "Аня")
      ],
      balanceObservations: [
        {
          amount: 200,
          currency: "EUR",
          occurredOn: "2026-08-04",
          account: "Карта",
          confidence: 0.9,
          ambiguities: []
        }
      ],
      ambiguities: []
    },
    {
      baseCurrency: "EUR",
      summary: {
        baseCurrency: "EUR",
        income: 0,
        expense: 0,
        incompleteOperationCount: 0,
        observedBalances: [{ account: "Карта", amount: 200 }],
        debt: {
          owedByUser: [
            { counterparty: "Петя", currency: "USD", amount: 350 },
            { counterparty: "Аня", currency: "EUR", amount: 100 }
          ],
          owedToUser: [
            { counterparty: "Олег", currency: "VND", amount: 2_000_000 }
          ]
        }
      }
    }
  );

  assert.match(preview, /<b>Долговые операции:<\/b>\n1\. Взял в долг — Петя/);
  assert.match(preview, /2\. Вернул долг — Петя/);
  assert.match(preview, /3\. Дал в долг — Аня/);
  assert.match(preview, /4\. Мне вернули долг — Аня/);
  assert.doesNotMatch(preview, /Д[1-4]\./);
  assert.doesNotMatch(preview, /Б1\./);
  assert.ok(preview.indexOf("Общий долг") < preview.indexOf("Общий остаток"));
  assert.ok(preview.indexOf("Всего должны мне") < preview.indexOf("Общий остаток"));
  assert.match(
    preview,
    /<b>Итог этого сообщения в EUR:<\/b>\n\n<b>Доход:<\/b>.*\n<b>Расход:<\/b>/
  );
  assert.match(
    preview,
    /<b>Расход:<\/b>.*\n\n<b>Общий долг:<\/b>/
  );
  assert.match(
    preview,
    /<b>Общий долг:<\/b> <b>100 EUR · 350 USD<\/b>/
  );
  assert.match(preview, /Петя — <b>350 USD<\/b>/);
  assert.match(preview, /Аня — <b>100 EUR<\/b>/);
  assert.match(
    preview,
    /Аня — <b>100 EUR<\/b>\n\n<b>Всего должны мне:<\/b>/
  );
  assert.match(
    preview,
    /<b>Всего должны мне:<\/b> <b>2[  ]000[  ]000 VND<\/b>/
  );
  assert.match(preview, /Олег — <b>2[  ]000[  ]000 VND<\/b>/);
  assert.match(
    preview,
    /Олег — <b>2[  ]000[  ]000 VND<\/b>\n\n<b>Общий остаток:<\/b>/
  );
});

test("shows several wallet balances separately and sums them once", () => {
  const parsed: ParsedBudgetMessageDraft = {
    transactions: [],
    debtOperations: [],
    balanceObservations: [
      { amount: 500, currency: "USD", occurredOn: "2026-08-08", account: "Карта", confidence: 1, ambiguities: [] },
      { amount: 2_500_000, currency: "VND", occurredOn: "2026-08-08", account: "Вьетнамский счёт", confidence: 1, ambiguities: [] }
    ],
    ambiguities: []
  };
  const preview = formatBudgetMessagePreview(parsed, {
    baseCurrency: "USD",
    summary: {
      baseCurrency: "USD",
      income: 0,
      expense: 0,
      incompleteOperationCount: 0,
      observedBalances: [
        { account: "Карта", amount: 500 },
        { account: "Вьетнамский счёт", amount: 100 }
      ],
      debt: { owedByUser: [], owedToUser: [] }
    }
  });

  assert.match(preview, /<b>Остатки по кошелькам:<\/b>/);
  assert.match(preview, /• Карта · <b>500 USD<\/b> · 08\.08\.2026/);
  assert.match(preview, /• Вьетнамский счёт · <b>2[  ]500[  ]000 VND<\/b> · 08\.08\.2026/);
  assert.match(preview, /<b>Общий остаток:<\/b> <b>600 USD<\/b>/);
  assert.doesNotMatch(preview, /Б[12]\./);
});

test("shows wallet ambiguities and blocks confirmation for repeated account rows", () => {
  const preview = formatBudgetMessagePreview({
    transactions: [],
    debtOperations: [],
    balanceObservations: [
      {
        amount: 2_000_000,
        currency: "VND",
        occurredOn: "2026-08-08",
        account: "Вьетнамский счёт",
        confidence: 0.7,
        ambiguities: ["Непонятно, один это счёт или два"]
      },
      {
        amount: 400_000,
        currency: "VND",
        occurredOn: "2026-08-08",
        account: "Вьетнамский счёт",
        confidence: 0.7,
        ambiguities: []
      }
    ],
    ambiguities: []
  });

  assert.match(preview, /Остаток 2[  ]000[  ]000 VND — Непонятно, один это счёт или два/);
  assert.match(preview, /указано несколько сумм\. Скажите, объединить их или назвать счета отдельно/);
  assert.match(preview, /<b>Сначала уточним эти пункты\.<\/b>/);
  assert.doesNotMatch(preview, /<b>Всё совпало\?<\/b>/);
});

test("does not invite confirmation for a non-financial message", () => {
  const preview = formatBudgetMessagePreview(
    {
      transactions: [],
      debtOperations: [],
      balanceObservations: [],
      ambiguities: []
    },
    { savingEnabled: true }
  );

  assert.match(preview, /Ничего не записано/);
  assert.doesNotMatch(preview, /всё верно|запишу подтверждённые данные/i);
});

test("keeps complete clarification text when the preview fits Telegram", () => {
  const clarification =
    "Нужно уточнить сумму в донгах после обмена, если она отличалась от эквивалента исходных 177 USD, и подтвердить, что вся сумма пришла на Вьетнамский счёт.";
  const preview = formatBudgetMessagePreview({
    transactions: [
      {
        ...createDraft("income"),
        account: "Crypto",
        note: clarification
      }
    ],
    debtOperations: [],
    balanceObservations: [],
    ambiguities: [clarification]
  });

  assert.ok(renderedTelegramLength(preview) <= 4096);
  assert.match(preview, /вся сумма пришла на Вьетнамский счёт\./);
  assert.doesNotMatch(preview, /эквивалента исходных…/);
});

test("escapes dynamic text before sending Telegram HTML", () => {
  const preview = formatBudgetMessagePreview({
    transactions: [
      {
        ...createDraft("expense"),
        category: "Еда & напитки",
        description: "Кофе <small>",
        note: "Чек > ожиданий"
      }
    ],
    debtOperations: [],
    balanceObservations: [],
    ambiguities: []
  });

  assert.match(preview, /<b>Еда &amp; напитки<\/b>/);
  assert.match(preview, /«Кофе &lt;small&gt;»/);
  assert.match(preview, /комментарий: Чек &gt; ожиданий/);
  assert.doesNotMatch(preview, /<small>/);
});

test("keeps a maximum-size batch inside one Telegram message", () => {
  const longText = "Очень длинное синтетическое описание ".repeat(20);
  const preview = formatBudgetMessagePreview({
    transactions: Array.from({ length: 20 }, (_, index) => ({
      ...createDraft(index % 2 ? "expense" : "income"),
      account: null,
      description: `${longText}${index}`,
      note: longText,
      ambiguities: [longText]
    })),
    debtOperations: [],
    balanceObservations: [],
    ambiguities: [longText]
  });

  assert.ok(renderedTelegramLength(preview) <= 4096);
  assert.match(
    preview,
    /Пока это только черновик — в Notion ничего не записано\.$/
  );
});

test("Telegram revises a combined preview from a normal text reply", async () => {
  const initialParsed: ParsedBudgetMessageDraft = {
    transactions: [createDraft("income"), createDraft("expense")],
    debtOperations: [],
    balanceObservations: [
      {
        amount: 20_000,
        currency: "VND",
        occurredOn: "2026-08-04",
        account: null,
        confidence: 0.7,
        ambiguities: ["Не указан счёт"]
      }
    ],
    ambiguities: []
  };
  const revisionCalls: Array<{ preview: string; instruction: string }> = [];
  const parser: TransactionTextParser = {
    async parse() {
      return initialParsed;
    },
    async revise(preview, instruction) {
      revisionCalls.push({ preview, instruction });
      return {
        transactions: [
          {
            ...initialParsed.transactions[0]!,
            account: "Карта"
          }
        ],
        debtOperations: [],
        balanceObservations: [
          {
            ...initialParsed.balanceObservations[0]!,
            account: "Карта",
            ambiguities: []
          }
        ],
        ambiguities: []
      };
    }
  };
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: "123456:test-token",
    TELEGRAM_ALLOWED_USER_IDS: "100001",
    REPORTS_WEB_APP_URL: "https://budget.example/reports.html"
  });
  const bot = createTelegramBotApp(config, {
    parser,
    currencyConverter: passthroughCurrencyConverter,
    userSettingsRepository: createUserSettingsRepository()
  });
  const sentMessages: Array<Record<string, unknown>> = [];

  bot.api.config.use(
    (async (
      _previous: unknown,
      method: string,
      payload: Record<string, unknown>
    ) => {
      if (method === "getMe") {
        return {
          ok: true,
          result: {
            id: 123456,
            is_bot: true,
            first_name: "Budget Test Bot",
            username: "budget_test_bot"
          }
        };
      }
      if (method === "sendChatAction") {
        return { ok: true, result: true };
      }
      if (method === "answerCallbackQuery") {
        return { ok: true, result: true };
      }
      if (method === "sendMessage") {
        sentMessages.push(payload);
        return {
          ok: true,
          result: {
            message_id: sentMessages.length,
            date: 1_775_290_700,
            chat: { id: 100001, type: "private", first_name: "Owner" },
            text: payload.text
          }
        };
      }
      throw new Error(`Unexpected Telegram method: ${method}`);
    }) as Parameters<typeof bot.api.config.use>[0]
  );

  await bot.init();

  await bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 10,
      date: 1_775_290_700,
      chat: { id: 100001, type: "private", first_name: "Owner" },
      from: {
        id: 100001,
        is_bot: false,
        first_name: "Owner"
      },
      text: "Получил доход, сделал расход и сообщил остаток"
    }
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0]?.parse_mode, "HTML");
  assert.match(
    String(sentMessages[0]?.text),
    /<b>Вот что я понял из сообщения:<\/b>/
  );
  assert.match(String(sentMessages[0]?.text), /1\. Доход/);
  assert.match(String(sentMessages[0]?.text), /2\. Расход/);
  assert.doesNotMatch(String(sentMessages[0]?.text), /Б1\./);
  assert.match(
    String(sentMessages[0]?.text),
    /<b>Итог этого сообщения в EUR:<\/b>/
  );
  assert.match(String(sentMessages[0]?.text), /<b>Доход:<\/b> <b>50 EUR<\/b>/);
  assert.match(String(sentMessages[0]?.text), /<b>Расход:<\/b> <b>50 EUR<\/b>/);
  assert.match(
    String(sentMessages[0]?.text),
    /<b>Общий остаток:<\/b> <b>20[  ]000 EUR<\/b>/
  );
  assert.doesNotMatch(
    String(sentMessages[0]?.text),
    /Общий остаток на «Вьетнамский счёт»/
  );

  const initialReplyMarkup = JSON.stringify(sentMessages[0]?.reply_markup);
  assert.match(initialReplyMarkup, /preview:correct/);
  assert.doesNotMatch(
    initialReplyMarkup,
    /preview:confirm/,
    "confirmation stays hidden while the draft has unresolved fields"
  );

  await bot.handleUpdate({
    update_id: 2,
    message: {
      message_id: 11,
      date: 1_775_290_701,
      chat: { id: 100001, type: "private", first_name: "Owner" },
      from: {
        id: 100001,
        is_bot: false,
        first_name: "Owner"
      },
      text: "Для всех счёт Карта; отмени 2",
      reply_to_message: {
        message_id: 1,
        date: 1_775_290_700,
        chat: { id: 100001, type: "private", first_name: "Owner" },
        from: {
          id: 123456,
          is_bot: true,
          first_name: "Budget Test Bot",
          username: "budget_test_bot"
        },
        text: String(sentMessages[0]?.text),
        reply_to_message: undefined
      }
    }
  });

  assert.equal(sentMessages.length, 2);
  assert.equal(revisionCalls.length, 1);
  assert.match(
    revisionCalls[0]!.preview,
    /Пока это только черновик — в Notion ничего не записано/
  );
  assert.equal(revisionCalls[0]!.instruction, "Для всех счёт Карта; отмени 2");
  assert.match(String(sentMessages[1]?.text), /1\. Доход.*Карта/);
  assert.doesNotMatch(String(sentMessages[1]?.text), /2\. Расход/);
  assert.doesNotMatch(String(sentMessages[1]?.text), /Б1\./);
  assert.match(JSON.stringify(sentMessages[1]?.reply_markup), /preview:confirm/);
  assert.match(JSON.stringify(sentMessages[1]?.reply_markup), /preview:correct/);

  await bot.handleUpdate({
    update_id: 3,
    message: {
      message_id: 12,
      date: 1_775_290_702,
      chat: { id: 100001, type: "private", first_name: "Owner" },
      from: {
        id: 100001,
        is_bot: false,
        first_name: "Owner"
      },
      text: "Всё верно",
      reply_to_message: {
        message_id: 2,
        date: 1_775_290_701,
        chat: { id: 100001, type: "private", first_name: "Owner" },
        from: {
          id: 123456,
          is_bot: true,
          first_name: "Budget Test Bot",
          username: "budget_test_bot"
        },
        text: String(sentMessages[1]?.text),
        reply_to_message: undefined
      }
    }
  });

  assert.equal(sentMessages.length, 3);
  assert.equal(revisionCalls.length, 1, "confirmation should not call OpenAI again");
  assert.match(String(sentMessages[2]?.text), /Все пункты проверены/);

  await bot.handleUpdate({
    update_id: 4,
    message: {
      message_id: 13,
      date: 1_775_290_703,
      chat: { id: 100001, type: "private", first_name: "Owner" },
      from: {
        id: 100001,
        is_bot: false,
        first_name: "Owner"
      },
      text: "Отмени всё",
      reply_to_message: {
        message_id: 1,
        date: 1_775_290_700,
        chat: { id: 100001, type: "private", first_name: "Owner" },
        from: {
          id: 123456,
          is_bot: true,
          first_name: "Budget Test Bot",
          username: "budget_test_bot"
        },
        text: String(sentMessages[0]?.text),
        reply_to_message: undefined
      }
    }
  });

  assert.equal(sentMessages.length, 4);
  assert.equal(revisionCalls.length, 1, "whole cancellation should be deterministic");
  assert.match(String(sentMessages[3]?.text), /Весь черновик отменён/);
});

test("Telegram Correct button opens a normal text correction reply", async () => {
  const parsed: ParsedBudgetMessageDraft = {
    transactions: [{ ...createDraft("expense"), account: "Карта" }],
    debtOperations: [],
    balanceObservations: [],
    ambiguities: []
  };
  const bot = createTelegramBotApp(
    loadConfig({
      TELEGRAM_BOT_TOKEN: "123456:test-token",
      TELEGRAM_ALLOWED_USER_IDS: "100001"
    }),
    {
      parser: {
        async parse() { return parsed; },
        async revise() { throw new Error("not used"); }
      },
      currencyConverter: passthroughCurrencyConverter,
      userSettingsRepository: createUserSettingsRepository()
    }
  );
  const sent: Array<Record<string, unknown>> = [];
  bot.api.config.use((async (
    _previous: unknown,
    method: string,
    payload: Record<string, unknown>
  ) => {
    if (method === "getMe") {
      return { ok: true, result: { id: 123456, is_bot: true, first_name: "Bot", username: "bot" } };
    }
    if (method === "sendChatAction" || method === "answerCallbackQuery") {
      return { ok: true, result: true };
    }
    if (method === "sendMessage") {
      sent.push(payload);
      return { ok: true, result: { message_id: sent.length, date: 1, chat: { id: 100001, type: "private", first_name: "Owner" }, text: payload.text } };
    }
    throw new Error(`Unexpected Telegram method: ${method}`);
  }) as Parameters<typeof bot.api.config.use>[0]);
  await bot.init();

  await bot.handleUpdate({ update_id: 20, message: { message_id: 30, date: 1, chat: { id: 100001, type: "private", first_name: "Owner" }, from: { id: 100001, is_bot: false, first_name: "Owner" }, text: "Потратил 50 USD с карты" } });
  assert.match(JSON.stringify(sent[0]?.reply_markup), /preview:correct/);

  await bot.handleUpdate({ update_id: 21, callback_query: { id: "correct-1", from: { id: 100001, is_bot: false, first_name: "Owner" }, chat_instance: "chat-instance", data: "preview:correct", message: { message_id: 1, date: 1, chat: { id: 100001, type: "private", first_name: "Owner" }, text: String(sent[0]?.text) } } });

  assert.equal(sent.length, 2);
  assert.equal(sent[1]?.text, sent[0]?.text);
  assert.equal(
    (sent[1]?.reply_markup as { force_reply?: boolean }).force_reply,
    true
  );
  assert.match(
    String((sent[1]?.reply_markup as { input_field_placeholder?: string }).input_field_placeholder),
    /для всех счёт Карта/
  );
});

test("Telegram requires onboarding currency and keeps it in user settings", async () => {
  let savedSettings: UserSettings | null = null;
  let parseCalls = 0;
  const userSettingsRepository: UserSettingsRepository = {
    async findByTelegramUserId(telegramUserId) {
      return savedSettings?.telegramUserId === telegramUserId
        ? savedSettings
        : null;
    },
    async save(settings) {
      savedSettings = settings;
    }
  };
  const parser: TransactionTextParser = {
    async parse() {
      parseCalls += 1;
      return {
        transactions: [
          {
            ...createDraft("income"),
            account: "Crypto"
          }
        ],
        debtOperations: [],
        balanceObservations: [],
        ambiguities: []
      };
    },
    async revise() {
      throw new Error("not used");
    }
  };
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: "123456:test-token",
    TELEGRAM_ALLOWED_USER_IDS: "100001",
    REPORTS_WEB_APP_URL: "https://budget.example/reports.html"
  });
  const bot = createTelegramBotApp(config, {
    parser,
    currencyConverter: passthroughCurrencyConverter,
    userSettingsRepository
  });
  const sentMessages: Array<Record<string, unknown>> = [];
  const editedMessages: Array<Record<string, unknown>> = [];

  bot.api.config.use(
    (async (
      _previous: unknown,
      method: string,
      payload: Record<string, unknown>
    ) => {
      if (method === "getMe") {
        return {
          ok: true,
          result: {
            id: 123456,
            is_bot: true,
            first_name: "Budget Test Bot",
            username: "budget_test_bot"
          }
        };
      }
      if (method === "sendMessage") {
        sentMessages.push(payload);
        return {
          ok: true,
          result: {
            message_id: sentMessages.length,
            date: 1_775_463_000,
            chat: { id: 100001, type: "private", first_name: "Owner" },
            text: payload.text
          }
        };
      }
      if (method === "editMessageText") {
        editedMessages.push(payload);
        return {
          ok: true,
          result: {
            message_id: 1,
            date: 1_775_463_000,
            chat: { id: 100001, type: "private", first_name: "Owner" },
            text: payload.text
          }
        };
      }
      if (method === "answerCallbackQuery" || method === "sendChatAction") {
        return { ok: true, result: true };
      }
      throw new Error(`Unexpected Telegram method: ${method}`);
    }) as Parameters<typeof bot.api.config.use>[0]
  );

  await bot.init();

  await bot.handleUpdate({
    update_id: 10,
    message: {
      message_id: 20,
      date: 1_775_463_000,
      chat: { id: 100001, type: "private", first_name: "Owner" },
      from: { id: 100001, is_bot: false, first_name: "Owner" },
      text: "/start",
      entities: [{ type: "bot_command", offset: 0, length: 6 }]
    }
  });

  assert.match(String(sentMessages[0]?.text), /выберем основную валюту/i);
  assert.match(JSON.stringify(sentMessages[0]?.reply_markup), /force_reply/);
  assert.doesNotMatch(
    JSON.stringify(sentMessages[0]?.reply_markup),
    /settings:currency:/
  );

  await bot.handleUpdate({
    update_id: 11,
    message: {
      message_id: 21,
      date: 1_775_463_001,
      chat: { id: 100001, type: "private", first_name: "Owner" },
      from: { id: 100001, is_bot: false, first_name: "Owner" },
      text: "Получил 50 USD"
    }
  });

  assert.equal(parseCalls, 0, "OpenAI must not run before currency selection");
  assert.match(String(sentMessages[1]?.text), /Сначала выберите основную валюту/);

  await bot.handleUpdate({
    update_id: 12,
    message: {
      message_id: 22,
      date: 1_775_463_002,
      chat: { id: 100001, type: "private", first_name: "Owner" },
      from: { id: 100001, is_bot: false, first_name: "Owner" },
      text: "дол",
      reply_to_message: {
        message_id: 1,
        date: 1_775_463_000,
        chat: { id: 100001, type: "private", first_name: "Owner" },
        from: {
          id: 123456,
          is_bot: true,
          first_name: "Budget Test Bot",
          username: "budget_test_bot"
        },
        text: String(sentMessages[0]?.text),
        reply_to_message: undefined
      }
    }
  });

  assert.match(String(sentMessages[2]?.text), /Нашёл несколько валют/);
  assert.match(
    JSON.stringify(sentMessages[2]?.reply_markup),
    /settings:currency:USD/
  );
  assert.match(
    JSON.stringify(sentMessages[2]?.reply_markup),
    /settings:currency:AUD/
  );

  await bot.handleUpdate({
    update_id: 13,
    callback_query: {
      id: "callback-1",
      from: { id: 100001, is_bot: false, first_name: "Owner" },
      chat_instance: "chat-instance",
      data: "settings:currency:USD",
      message: {
        message_id: 3,
        date: 1_775_463_000,
        chat: { id: 100001, type: "private", first_name: "Owner" },
        text: String(sentMessages[2]?.text)
      }
    }
  });

  assert.deepEqual(savedSettings, {
    telegramUserId: "100001",
    baseCurrency: "USD",
    onboardingHelpShown: true
  });
  assert.match(String(editedMessages[0]?.text), /основная валюта USD/);

  await bot.handleUpdate({
    update_id: 14,
    message: {
      message_id: 23,
      date: 1_775_463_003,
      chat: { id: 100001, type: "private", first_name: "Owner" },
      from: { id: 100001, is_bot: false, first_name: "Owner" },
      text: "Получил 50 USD"
    }
  });

  assert.equal(parseCalls, 1);
  assert.match(
    String(sentMessages[3]?.text),
    /<b>Итог этого сообщения в USD:<\/b>/
  );
  assert.match(String(sentMessages[3]?.text), /<b>Доход:<\/b> <b>50 USD<\/b>/);
  assert.match(
    String(sentMessages[3]?.text),
    /<b>Общий остаток:<\/b> в этом сообщении не указан\./
  );

  await bot.handleUpdate({
    update_id: 15,
    message: {
      message_id: 24,
      date: 1_775_463_004,
      chat: { id: 100001, type: "private", first_name: "Owner" },
      from: { id: 100001, is_bot: false, first_name: "Owner" },
      text: "/start",
      entities: [{ type: "bot_command", offset: 0, length: 6 }]
    }
  });
  assert.match(String(sentMessages[4]?.text), /С возвращением/);
  assert.doesNotMatch(String(sentMessages[4]?.text), /Слово «тоже»/);

  await bot.handleUpdate({
    update_id: 16,
    message: {
      message_id: 25,
      date: 1_775_463_005,
      chat: { id: 100001, type: "private", first_name: "Owner" },
      from: { id: 100001, is_bot: false, first_name: "Owner" },
      text: "/help",
      entities: [{ type: "bot_command", offset: 0, length: 5 }]
    }
  });
  assert.match(String(sentMessages[5]?.text), /<b>Как со мной работать<\/b>/);
  assert.match(String(sentMessages[5]?.text), /Слово «тоже»/);

  await bot.handleUpdate({
    update_id: 17,
    message: {
      message_id: 26,
      date: 1_775_463_006,
      chat: { id: 100001, type: "private", first_name: "Owner" },
      from: { id: 100001, is_bot: false, first_name: "Owner" },
      text: "/settings",
      entities: [{ type: "bot_command", offset: 0, length: 9 }]
    }
  });
  assert.match(String(sentMessages[6]?.text), /Основная валюта: <b>USD<\/b>/);
  assert.match(JSON.stringify(sentMessages[6]?.reply_markup), /force_reply/);

  await bot.handleUpdate({
    update_id: 18,
    message: {
      message_id: 27,
      date: 1_775_463_007,
      chat: { id: 100001, type: "private", first_name: "Owner" },
      from: { id: 100001, is_bot: false, first_name: "Owner" },
      text: "евро",
      reply_to_message: {
        message_id: 7,
        date: 1_775_463_006,
        chat: { id: 100001, type: "private", first_name: "Owner" },
        from: {
          id: 123456,
          is_bot: true,
          first_name: "Budget Test Bot",
          username: "budget_test_bot"
        },
        text: String(sentMessages[6]?.text),
        reply_to_message: undefined
      }
    }
  });
  assert.equal(parseCalls, 1, "currency search must not call OpenAI");
  assert.deepEqual(savedSettings, {
    telegramUserId: "100001",
    baseCurrency: "EUR",
    onboardingHelpShown: true
  });
  assert.match(
    String(sentMessages[7]?.text),
    /<b>Готово\. Основная валюта: EUR\.<\/b>/
  );

  await bot.handleUpdate({
    update_id: 19,
    message: {
      message_id: 28,
      date: 1_775_463_008,
      chat: { id: 100001, type: "private", first_name: "Owner" },
      from: { id: 100001, is_bot: false, first_name: "Owner" },
      text: "/reports",
      entities: [{ type: "bot_command", offset: 0, length: 8 }]
    }
  });
  assert.match(String(sentMessages[8]?.text), /выберите месяц и вид диаграммы/i);
  assert.match(
    JSON.stringify(sentMessages[8]?.reply_markup),
    /https:\/\/budget\.example\/reports\.html/
  );
});

test("Telegram persists a normalized draft and saves it once on confirmation", async () => {
  let stored: StoredTelegramDraft | null = null;
  const trashed: string[] = [];
  const deleted: number[] = [];
  const saveInputs: unknown[] = [];
  const draftRepository: TelegramDraftRepository = {
    async save(draft) {
      stored = { ...draft, pageId: `draft-${draft.previewMessageId}` };
      return stored;
    },
    async find(chatId, previewMessageId) {
      return stored?.chatId === chatId && stored.previewMessageId === previewMessageId
        ? stored
        : null;
    },
    async trash(pageId) { trashed.push(pageId); }
  };
  const parsed: ParsedBudgetMessageDraft = {
    transactions: [], debtOperations: [],
    balanceObservations: [{ amount: 132, currency: "EUR", occurredOn: "2026-08-08", account: null, confidence: 1, ambiguities: [] }],
    ambiguities: []
  };
  const parser: TransactionTextParser = {
    async parse() { return parsed; },
    async revise() { throw new Error("not used"); }
  };
  const bot = createTelegramBotApp(
    loadConfig({ TELEGRAM_BOT_TOKEN: "123456:test-token", TELEGRAM_ALLOWED_USER_IDS: "100001" }),
    {
      parser, currencyConverter: passthroughCurrencyConverter,
      userSettingsRepository: createUserSettingsRepository(),
      telegramDraftRepository: draftRepository,
      financialSaveService: {
        async previewCurrentBalance() { return null; },
        async save(input) {
          saveInputs.push(input);
          return { status: "saved" as const, openingBalanceCreated: true, transactionCount: 0, debtOperationCount: 0, balanceObservationCount: 1, historicalOperationCount: 0, currentBalance: 132, baseCurrency: "EUR" as const };
        }
      }
    }
  );
  const sent: Array<Record<string, unknown>> = [];
  bot.api.config.use((async (_previous: unknown, method: string, payload: Record<string, unknown>) => {
    if (method === "getMe") return { ok: true, result: { id: 123456, is_bot: true, first_name: "Bot", username: "bot" } };
    if (method === "sendChatAction") return { ok: true, result: true };
    if (method === "answerCallbackQuery") return { ok: true, result: true };
    if (method === "deleteMessage") { deleted.push(Number(payload.message_id)); return { ok: true, result: true }; }
    if (method === "sendMessage") {
      sent.push(payload);
      return { ok: true, result: { message_id: sent.length, date: 1, chat: { id: 100001, type: "private", first_name: "Owner" }, text: payload.text } };
    }
    throw new Error(`Unexpected Telegram method: ${method}`);
  }) as Parameters<typeof bot.api.config.use>[0]);
  await bot.init();
  await bot.handleUpdate({ update_id: 100, message: { message_id: 10, date: 1, chat: { id: 100001, type: "private", first_name: "Owner" }, from: { id: 100001, is_bot: false, first_name: "Owner" }, text: "Остаток 132 EUR" } });
  assert.match(String(sent[0]?.text), /После подтверждения «Всё верно»/);
  assert.match(JSON.stringify(sent[0]?.reply_markup), /preview:confirm/);
  assert.match(JSON.stringify(sent[0]?.reply_markup), /preview:correct/);
  assert.ok(stored);
  const persistedDraft = stored as StoredTelegramDraft;
  assert.doesNotMatch(persistedDraft.serializedDraft, /Остаток 132 EUR/);

  await bot.handleUpdate({ update_id: 101, callback_query: { id: "confirm-1", from: { id: 100001, is_bot: false, first_name: "Owner" }, chat_instance: "chat-instance", data: "preview:confirm", message: { message_id: 1, date: 1, chat: { id: 100001, type: "private", first_name: "Owner" }, text: String(sent[0]?.text) } } });
  assert.equal(saveInputs.length, 1);
  assert.deepEqual(deleted, [10, 1]);
  assert.deepEqual(trashed, ["draft-1"]);
  assert.match(String(sent[1]?.text), /Стартовый остаток записан/);
});

test("Telegram refreshes an unresolved wallet draft instead of calling Notion", async () => {
  const parsed: ParsedBudgetMessageDraft = {
    transactions: [],
    debtOperations: [],
    balanceObservations: [
      { amount: 2_000_000, currency: "VND", occurredOn: "2026-08-08", account: "Вьетнамский счёт", confidence: 0.8, ambiguities: [] },
      { amount: 400_000, currency: "VND", occurredOn: "2026-08-08", account: "Вьетнамский счёт", confidence: 0.8, ambiguities: [] }
    ],
    ambiguities: []
  };
  let stored: StoredTelegramDraft | null = {
    pageId: "draft-old",
    telegramUserId: "100001",
    chatId: "100001",
    sourceMessageId: 10,
    previewMessageId: 1,
    serializedDraft: JSON.stringify({
      parsed,
      previewMessageIds: [1],
      acceptBalanceMismatch: false
    }),
    expiresAt: "2099-01-01T00:00:00.000Z"
  };
  const trashed: string[] = [];
  let saveCalls = 0;
  const bot = createTelegramBotApp(
    loadConfig({
      TELEGRAM_BOT_TOKEN: "123456:test-token",
      TELEGRAM_ALLOWED_USER_IDS: "100001"
    }),
    {
      parser: { async parse() { return parsed; }, async revise() { return parsed; } },
      currencyConverter: passthroughCurrencyConverter,
      userSettingsRepository: createUserSettingsRepository(),
      telegramDraftRepository: {
        async save(value) {
          stored = { ...value, pageId: `draft-${value.previewMessageId}` };
          return stored;
        },
        async find(chatId, previewMessageId) {
          return stored?.chatId === chatId && stored.previewMessageId === previewMessageId
            ? stored
            : null;
        },
        async trash(pageId) { trashed.push(pageId); }
      },
      financialSaveService: {
        async previewCurrentBalance() { return null; },
        async save() {
          saveCalls += 1;
          throw new Error("must not save an unresolved draft");
        }
      }
    }
  );
  const sent: Array<Record<string, unknown>> = [];
  bot.api.config.use((async (_previous: unknown, method: string, payload: Record<string, unknown>) => {
    if (method === "getMe") return { ok: true, result: { id: 123456, is_bot: true, first_name: "Bot", username: "bot" } };
    if (method === "sendChatAction") return { ok: true, result: true };
    if (method === "sendMessage") {
      sent.push(payload);
      return { ok: true, result: { message_id: 2, date: 2, chat: { id: 100001, type: "private", first_name: "Owner" }, text: payload.text } };
    }
    throw new Error(`Unexpected Telegram method: ${method}`);
  }) as Parameters<typeof bot.api.config.use>[0]);
  await bot.init();

  const originalPreview = formatBudgetMessagePreview(parsed, {
    savingEnabled: true
  });
  await bot.handleUpdate({
    update_id: 102,
    message: {
      message_id: 11,
      date: 2,
      chat: { id: 100001, type: "private", first_name: "Owner" },
      from: { id: 100001, is_bot: false, first_name: "Owner" },
      text: "всё верно",
      reply_to_message: {
        message_id: 1,
        date: 1,
        chat: { id: 100001, type: "private", first_name: "Owner" },
        from: { id: 123456, is_bot: true, first_name: "Bot" },
        text: originalPreview,
        reply_to_message: undefined
      }
    }
  });

  assert.equal(saveCalls, 0);
  assert.match(String(sent[0]?.text), /объединить их или назвать счета отдельно/);
  assert.doesNotMatch(String(sent[0]?.text), /Не удалось завершить запись в Notion/);
  assert.deepEqual(trashed, ["draft-old"]);
  assert.equal(stored?.previewMessageId, 2);
});

test("Telegram writes a normalized fallback and keeps messages when Notion fails", async () => {
  const parsed = balanceOnlyDraftForTelegram();
  const stored: StoredTelegramDraft = {
    pageId: "draft-page", telegramUserId: "100001", chatId: "100001",
    sourceMessageId: 10, previewMessageId: 1,
    serializedDraft: JSON.stringify({ parsed, previewMessageIds: [1], acceptBalanceMismatch: false }),
    expiresAt: "2099-01-01T00:00:00.000Z"
  };
  let fallback: unknown = null;
  const deleted: number[] = [];
  const sent: Array<Record<string, unknown>> = [];
  const bot = createTelegramBotApp(
    loadConfig({ TELEGRAM_BOT_TOKEN: "123456:test-token", TELEGRAM_ALLOWED_USER_IDS: "100001" }),
    {
      parser: { async parse() { return parsed; }, async revise() { return parsed; } },
      currencyConverter: passthroughCurrencyConverter,
      userSettingsRepository: createUserSettingsRepository(),
      telegramDraftRepository: {
        async save(value) { return { ...value, pageId: "new-draft" }; },
        async find() { return stored; }, async trash() {}
      },
      financialSaveService: {
        async previewCurrentBalance() { return null; },
        async save() { throw new Error("Notion transaction write failed (503): unavailable"); }
      },
      notionWriteFailureRepository: {
        async save(value) { fallback = value; return { path: "/tmp/failure.json" }; }
      }
    }
  );
  bot.api.config.use((async (_previous: unknown, method: string, payload: Record<string, unknown>) => {
    if (method === "getMe") return { ok: true, result: { id: 123456, is_bot: true, first_name: "Bot", username: "bot" } };
    if (method === "sendChatAction") return { ok: true, result: true };
    if (method === "deleteMessage") { deleted.push(Number(payload.message_id)); return { ok: true, result: true }; }
    if (method === "sendMessage") { sent.push(payload); return { ok: true, result: { message_id: 2, date: 2, chat: { id: 100001, type: "private", first_name: "Owner" }, text: payload.text } }; }
    throw new Error(`Unexpected Telegram method: ${method}`);
  }) as Parameters<typeof bot.api.config.use>[0]);
  await bot.init();
  await bot.handleUpdate({ update_id: 102, message: { message_id: 11, date: 2, chat: { id: 100001, type: "private", first_name: "Owner" }, from: { id: 100001, is_bot: false, first_name: "Owner" }, text: "всё верно", reply_to_message: { message_id: 1, date: 1, chat: { id: 100001, type: "private", first_name: "Owner" }, from: { id: 123456, is_bot: true, first_name: "Bot" }, text: "Это черновик. После ответа «всё верно» я запишу подтверждённые данные в Notion.", reply_to_message: undefined } } });
  assert.ok(fallback);
  assert.deepEqual(deleted, []);
  assert.match(String(sent[0]?.text), /Черновик и сообщения сохранены/);
  assert.deepEqual((fallback as { normalizedDraft: unknown }).normalizedDraft, parsed);
});

function balanceOnlyDraftForTelegram(): ParsedBudgetMessageDraft {
  return { transactions: [], debtOperations: [], balanceObservations: [{ amount: 132, currency: "EUR", occurredOn: "2026-08-08", account: null, confidence: 1, ambiguities: [] }], ambiguities: [] };
}

function createDraft(
  direction: "expense" | "income" | "transfer"
): ParsedTransactionDraft {
  return {
    amount: 50,
    currency: "USD",
    direction,
    occurredOn: "2026-08-04",
    category: direction === "income" ? "Работа" : "Другое",
    account: null,
    destinationAccount: null,
    description: "Тест",
    note: null,
    confidence: 0.9,
    ambiguities: []
  };
}

function createDebtOperation(
  action: ParsedDebtOperationDraft["action"],
  counterparty: string | null
): ParsedDebtOperationDraft {
  return {
    amount: 50,
    currency: "EUR",
    action,
    occurredOn: "2026-08-04",
    counterparty,
    account: "Карта",
    description: "Долг",
    note: null,
    confidence: 0.9,
    ambiguities: []
  };
}

const passthroughCurrencyConverter: CurrencyConverter = {
  async convert(input) {
    return {
      originalAmount: input.amount,
      originalCurrency: input.from,
      occurredOn: input.occurredOn,
      convertedAmount: input.amount,
      targetCurrency: input.to ?? "EUR",
      rate: 1,
      rateDate: input.occurredOn
    };
  }
};

function createUserSettingsRepository(): UserSettingsRepository {
  let settings: UserSettings = {
    telegramUserId: "100001",
    baseCurrency: "EUR",
    onboardingHelpShown: true
  };

  return {
    async findByTelegramUserId(telegramUserId) {
      return telegramUserId === settings.telegramUserId ? settings : null;
    },
    async save(nextSettings) {
      settings = nextSettings;
    }
  };
}

function renderedTelegramLength(value: string): number {
  return value
    .replace(/<\/?b>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").length;
}
