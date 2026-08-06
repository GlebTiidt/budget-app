import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  isTelegramMasterUserAllowed,
  verifyTelegramWebAppInitData
} from "../../../src/integrations/telegram/telegramWebAppAuth.js";

const botToken = "123456:test-bot-token";
const now = new Date("2026-08-06T12:00:00.000Z");

test("verifies signed Telegram Mini App identity", () => {
  const initData = signInitData({
    auth_date: String(Math.floor(now.getTime() / 1000) - 60),
    query_id: "query-1",
    user: JSON.stringify({ id: 100001, first_name: "Owner" })
  });

  assert.deepEqual(verifyTelegramWebAppInitData(initData, botToken, { now }), {
    userId: "100001",
    authDate: Math.floor(now.getTime() / 1000) - 60
  });
});

test("rejects tampered and expired Telegram Mini App data", () => {
  const current = signInitData({
    auth_date: String(Math.floor(now.getTime() / 1000)),
    user: JSON.stringify({ id: 100001 })
  });
  assert.throws(
    () =>
      verifyTelegramWebAppInitData(
        current.replace("100001", "200002"),
        botToken,
        { now }
      ),
    /signature/
  );

  const expired = signInitData({
    auth_date: String(Math.floor(now.getTime() / 1000) - 7_200),
    user: JSON.stringify({ id: 100001 })
  });
  assert.throws(
    () => verifyTelegramWebAppInitData(expired, botToken, { now }),
    /expired/
  );
});

test("allows the Notion report only for the explicit master user", () => {
  assert.equal(
    isTelegramMasterUserAllowed("100001", "100001", ["100001", "200002"]),
    true
  );
  assert.equal(
    isTelegramMasterUserAllowed("200002", "100001", ["100001", "200002"]),
    false,
    "an invited user must not see the owner's Notion report"
  );
  assert.equal(
    isTelegramMasterUserAllowed("100001", undefined, ["100001"]),
    false,
    "the report stays closed until an explicit master is configured"
  );
});

function signInitData(values: Record<string, string>): string {
  const params = new URLSearchParams(values);
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  params.set(
    "hash",
    createHmac("sha256", secretKey).update(dataCheckString).digest("hex")
  );
  return params.toString();
}
