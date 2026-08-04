import assert from "node:assert/strict";
import test from "node:test";
import { decode } from "@toon-format/toon";
import {
  encodeToonData,
  serializeParsePromptToToon,
  serializeRevisionPromptToToon
} from "../../../src/integrations/openai/toonPromptSerializer.js";

const context = {
  currentTimestamp: "2026-08-04T14:00:00.000Z",
  timezone: "Asia/Ho_Chi_Minh",
  categories: ["Работа", "Транспорт", "Подписки"],
  accounts: ["Crypto", "Вьетнамский счёт"],
  currencies: ["USD", "VND", "EUR"]
} as const;

test("serializes parser context as a valid TOON input block", () => {
  const prompt = serializeParsePromptToToon({
    ...context,
    currentMessage: "Перевёл 177 USD с Crypto на Вьетнамский счёт"
  });
  const decoded = decode(unwrapToonBlock(prompt));

  assert.deepEqual(decoded, {
    context: {
      currentTimestamp: context.currentTimestamp,
      timezone: context.timezone
    },
    catalogs: {
      categories: [...context.categories],
      accounts: [...context.accounts],
      currencies: [...context.currencies]
    },
    currentMessage: "Перевёл 177 USD с Crypto на Вьетнамский счёт"
  });
  assert.match(prompt, /^```toon\n/);
  assert.match(prompt, /accounts\[2/);
});

test("serializes revision lines without losing their order", () => {
  const prompt = serializeRevisionPromptToToon({
    ...context,
    currentPreviewLines: ["1. Доход — 177 USD · Crypto", "Б1. 20 000 VND"],
    userReplyLines: ["1: потом перевод на Вьетнамский счёт", "Б: тоже"]
  });
  const decoded = decode(unwrapToonBlock(prompt)) as {
    currentPreviewLines: string[];
    userReplyLines: string[];
  };

  assert.deepEqual(decoded.currentPreviewLines, [
    "1. Доход — 177 USD · Crypto",
    "Б1. 20 000 VND"
  ]);
  assert.deepEqual(decoded.userReplyLines, [
    "1: потом перевод на Вьетнамский счёт",
    "Б: тоже"
  ]);
});

test("TOON is more compact than pretty JSON for controlled prompt data", () => {
  const value = {
    transactions: Array.from({ length: 5 }, (_, index) => ({
      index: index + 1,
      amount: 177 + index,
      currency: "USD",
      account: "Crypto",
      destinationAccount: "Вьетнамский счёт"
    }))
  };

  assert.ok(encodeToonData(value).length < JSON.stringify(value, null, 2).length);
});

function unwrapToonBlock(value: string): string {
  return value.replace(/^```toon\n/, "").replace(/\n```$/, "");
}
