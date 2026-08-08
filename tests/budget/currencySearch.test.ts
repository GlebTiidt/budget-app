import assert from "node:assert/strict";
import test from "node:test";
import { searchSupportedCurrencies } from "../../src/budget/currencySearch.js";

test("finds a supported currency by code or Russian name", () => {
  assert.deepEqual(searchSupportedCurrencies("EUR"), ["EUR"]);
  assert.deepEqual(searchSupportedCurrencies("евро"), ["EUR"]);
  assert.deepEqual(searchSupportedCurrencies("донги"), ["VND"]);
});

test("returns several search results for an ambiguous partial name", () => {
  assert.deepEqual(searchSupportedCurrencies("дол"), ["USD", "AUD"]);
});

test("does not treat a transaction sentence as a currency selection", () => {
  assert.deepEqual(searchSupportedCurrencies("Получил 50 USD"), []);
  assert.deepEqual(searchSupportedCurrencies("x"), []);
});
