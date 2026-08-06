import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../../src/config/loadConfig.js";
import type {
  ParsedBudgetMessageDraft,
  ParsedTransactionDraft,
  TransactionTextParser
} from "../../../src/integrations/openai/openAiTransactionParser.js";
import {
  createTelegramPreviewBot,
  formatBudgetMessagePreview,
  isTelegramUserAllowed
} from "../../../src/integrations/telegram/telegramBot.js";

test("allows only configured Telegram users", () => {
  assert.equal(isTelegramUserAllowed(100001, ["100001"]), true);
  assert.equal(isTelegramUserAllowed(123, ["100001"]), false);
  assert.equal(isTelegramUserAllowed(undefined, ["100001"]), false);
});

test("formats all parsed items in one safe preview", () => {
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
      createDraft("income")
    ],
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
  assert.match(preview, /1\. Расход — <b>120[  ]000 VND<\/b>/);
  assert.match(preview, /2\. Доход — <b>50 USD<\/b>/);
  assert.match(preview, /<b>Кофешоп<\/b>/);
  assert.match(
    preview,
    /Б1\. На счёте «Вьетнамский счёт» осталось <b>20[  ]000 VND<\/b> на 04\.08\.2026\./
  );
  assert.match(preview, /Держу его отдельно, чтобы не считать доходом или расходом/);
  assert.match(preview, /<b>Всё совпало\?<\/b> Напишите «всё верно»\./);
  assert.match(preview, /Хотите что-то поправить\? Просто напишите/);
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
      }
    ],
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

  assert.match(preview, /1\. Расход — <b>50, валюта не указана<\/b>/);
  assert.match(preview, /низкая уверенность/);
  assert.match(
    preview,
    /Транзакция 1 «Покупка» — укажите валюту, категорию и счёт\./
  );
  assert.match(preview, /Наблюдение баланса Б1 — укажите счёт\./);
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
    balanceObservations: [],
    ambiguities: [clarification]
  });

  assert.ok(preview.length <= 4096);
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
    balanceObservations: [],
    ambiguities: [longText]
  });

  assert.ok(preview.length <= 4096);
  assert.match(
    preview,
    /Пока это только черновик — в Notion ничего не записано\.$/
  );
});

test("Telegram revises a combined preview from a normal text reply", async () => {
  const initialParsed: ParsedBudgetMessageDraft = {
    transactions: [createDraft("income"), createDraft("expense")],
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
    TELEGRAM_ALLOWED_USER_IDS: "100001"
  });
  const bot = createTelegramPreviewBot(config, { parser });
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
  assert.match(String(sentMessages[0]?.text), /Б1\./);

  const replyMarkup = sentMessages[0]?.reply_markup as {
    force_reply: boolean;
    input_field_placeholder: string;
  };
  assert.equal(replyMarkup.force_reply, true);
  assert.match(replyMarkup.input_field_placeholder, /для всех счёт Карта/);

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
  assert.match(String(sentMessages[1]?.text), /Б1\..*Карта/);

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
