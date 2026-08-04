import assert from "node:assert/strict";
import test from "node:test";
import {
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
