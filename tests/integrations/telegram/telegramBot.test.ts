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

  assert.match(preview, /Транзакции: 2 · Наблюдения баланса: 1/);
  assert.match(preview, /1\. Расход — 120[  ]000 VND/);
  assert.match(preview, /2\. Доход — 50 USD/);
  assert.match(preview, /Б1\. 20[  ]000 VND/);
  assert.match(preview, /Наблюдения баланса \(не доход и не расход\)/);
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
        description: "Покупка",
        note: null,
        confidence: 0.4,
        ambiguities: ["Не указана валюта"]
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
    ambiguities: []
  });

  assert.match(preview, /1\. Расход — 50, валюта не указана/);
  assert.match(preview, /низкая уверенность/);
  assert.match(
    preview,
    /Транзакция 1 «Покупка» — укажите валюту, категорию и счёт\./
  );
  assert.match(preview, /Наблюдение баланса Б1 — укажите счёт\./);
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
  assert.match(preview, /Preview: в Notion ничего не записано\.$/);
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
  assert.match(String(sentMessages[0]?.text), /Транзакции: 2/);
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
  assert.match(revisionCalls[0]!.preview, /Preview: в Notion ничего не записано/);
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
    description: "Тест",
    note: null,
    confidence: 0.9,
    ambiguities: []
  };
}
