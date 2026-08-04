import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../../src/config/loadConfig.js";
import type {
  ParsedTransactionDraft,
  TransactionTextParser
} from "../../../src/integrations/openai/openAiTransactionParser.js";
import {
  createTelegramPreviewBot,
  formatBalanceObservationPreview,
  formatBudgetMessageSummary,
  formatDraftPreview,
  isTelegramUserAllowed
} from "../../../src/integrations/telegram/telegramBot.js";

test("allows only configured Telegram users", () => {
  assert.equal(isTelegramUserAllowed(742932409, ["742932409"]), true);
  assert.equal(isTelegramUserAllowed(123, ["742932409"]), false);
  assert.equal(isTelegramUserAllowed(undefined, ["742932409"]), false);
});

test("formats a safe preview without claiming a Notion write", () => {
  const preview = formatDraftPreview({
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
  });

  assert.match(preview, /Расход: 120[  ]000 VND/);
  assert.match(preview, /Дата: 04\.08\.2026/);
  assert.match(preview, /Счёт: Вьетнамский счёт/);
  assert.match(preview, /Уверенность: высокая/);
  assert.match(preview, /в Notion ничего не записано/);
});

test("shows ambiguities and a lower-confidence warning", () => {
  const preview = formatDraftPreview({
    amount: 50,
    currency: "USD",
    direction: "expense",
    occurredOn: "2026-08-04",
    category: null,
    account: null,
    description: "Покупка",
    note: null,
    confidence: 0.4,
    ambiguities: ["Не указан счёт"]
  });

  assert.match(preview, /низкая — лучше уточнить/);
  assert.match(preview, /Нужно уточнить:\n• Не указан счёт/);
});

test("summarizes every transaction type and balance observation", () => {
  const summary = formatBudgetMessageSummary({
    transactions: [
      createDraft("income"),
      createDraft("expense"),
      createDraft("expense"),
      createDraft("transfer")
    ],
    balanceObservations: [
      {
        amount: 20_000,
        currency: "VND",
        occurredOn: "2026-08-04",
        account: null,
        confidence: 0.75,
        ambiguities: ["Не указан счёт"]
      }
    ],
    ambiguities: []
  });

  assert.match(summary, /Нашёл транзакций: 4/);
  assert.match(summary, /Доходы: 1 · Расходы: 2 · Переводы: 1/);
  assert.match(summary, /Наблюдения баланса: 1/);
});

test("formats each multi-transaction draft with its position", () => {
  const preview = formatDraftPreview(createDraft("expense"), {
    position: 2,
    total: 5
  });

  assert.match(preview, /^Транзакция 2 из 5/);
  assert.match(preview, /Расход: 50 USD/);
});

test("keeps an incomplete transaction visible without inventing currency", () => {
  const preview = formatDraftPreview({
    ...createDraft("expense"),
    currency: null,
    confidence: 0.3,
    ambiguities: ["Не указана валюта"]
  });

  assert.match(preview, /Расход: 50, валюта не указана/);
  assert.match(preview, /низкая — лучше уточнить/);
});

test("formats a balance observation as neither income nor expense", () => {
  const preview = formatBalanceObservationPreview(
    {
      amount: 20_000,
      currency: "VND",
      occurredOn: "2026-08-04",
      account: null,
      confidence: 0.7,
      ambiguities: ["Не указан счёт"]
    },
    { position: 1, total: 1 }
  );

  assert.match(preview, /Наблюдение баланса 1 из 1/);
  assert.match(preview, /Остаток: 20[  ]000 VND/);
  assert.match(preview, /Это не доход и не расход/);
});

test("Telegram sends a summary and an independently actionable preview for every item", async () => {
  const parser: TransactionTextParser = {
    async parse() {
      return {
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
    }
  };
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: "123456:test-token",
    TELEGRAM_ALLOWED_USER_IDS: "742932409"
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
      if (method === "sendMessage") {
        sentMessages.push(payload);
        return {
          ok: true,
          result: {
            message_id: sentMessages.length,
            date: 1_775_290_700,
            chat: { id: 742932409, type: "private", first_name: "Owner" },
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
      chat: { id: 742932409, type: "private", first_name: "Owner" },
      from: {
        id: 742932409,
        is_bot: false,
        first_name: "Owner"
      },
      text: "Получил доход, сделал расход и сообщил остаток"
    }
  });

  assert.equal(sentMessages.length, 4);
  assert.match(String(sentMessages[0]?.text), /Нашёл транзакций: 2/);
  assert.match(String(sentMessages[1]?.text), /Транзакция 1 из 2/);
  assert.match(String(sentMessages[2]?.text), /Транзакция 2 из 2/);
  assert.match(String(sentMessages[3]?.text), /Наблюдение баланса 1 из 1/);

  for (const message of sentMessages.slice(1)) {
    assert.ok(message.reply_markup, "every item preview must have its own controls");
  }
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
