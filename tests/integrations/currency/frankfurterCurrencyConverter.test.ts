import assert from "node:assert/strict";
import test from "node:test";
import { createFrankfurterCurrencyConverter } from "../../../src/integrations/currency/frankfurterCurrencyConverter.js";

test("uses rate 1 without an API request for EUR transactions", async () => {
  let calls = 0;
  const converter = createFrankfurterCurrencyConverter("https://example.test/v2", async () => {
    calls += 1;
    throw new Error("fetch should not be called");
  });

  const result = await converter.convert({ amount: 12.345, from: "eur", occurredOn: "2026-07-18" });

  assert.equal(calls, 0);
  assert.deepEqual(result, {
    originalAmount: 12.345,
    originalCurrency: "EUR",
    occurredOn: "2026-07-18",
    convertedAmount: 12.35,
    targetCurrency: "EUR",
    rate: 1,
    rateDate: "2026-07-18"
  });
});

test("converts VND to EUR using the requested transaction date", async () => {
  const converter = createFrankfurterCurrencyConverter(
    "https://example.test/v2",
    async (request) => {
      assert.equal(
        request.toString(),
        "https://example.test/v2/rate/VND/EUR?date=2026-07-18"
      );
      return Response.json({
        date: "2026-07-18",
        base: "VND",
        quote: "EUR",
        rate: 0.000033
      });
    }
  );

  const result = await converter.convert({
    amount: 150_000,
    from: "VND",
    occurredOn: "2026-07-18"
  });

  assert.equal(result.convertedAmount, 4.95);
  assert.equal(result.rate, 0.000033);
});

test("accepts the latest available prior rate on a non-trading day", async () => {
  const converter = createFrankfurterCurrencyConverter(
    "https://example.test/v2",
    async () => Response.json({ date: "2026-07-17", base: "USD", quote: "EUR", rate: 0.87 })
  );

  const result = await converter.convert({
    amount: 10,
    from: "USD",
    occurredOn: "2026-07-18"
  });

  assert.equal(result.convertedAmount, 8.7);
  assert.equal(result.rateDate, "2026-07-17");
});

test("rejects a future rate for a historical transaction", async () => {
  const converter = createFrankfurterCurrencyConverter(
    "https://example.test/v2",
    async () => Response.json({ date: "2026-07-19", base: "USD", quote: "EUR", rate: 0.87 })
  );

  await assert.rejects(
    converter.convert({ amount: 10, from: "USD", occurredOn: "2026-07-18" }),
    /after the transaction date/
  );
});
