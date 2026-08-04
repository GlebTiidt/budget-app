import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNTS } from "../../src/budget/catalog.js";

test("exposes the complete controlled account catalog", () => {
  assert.deepEqual(ACCOUNTS, [
    "Наличные",
    "Карта",
    "Сбережения",
    "Вьетнамский счёт",
    "Crypto"
  ]);
});
