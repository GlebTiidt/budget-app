import { createHmac, timingSafeEqual } from "node:crypto";

export type TelegramWebAppIdentity = {
  userId: string;
  authDate: number;
};

export function isTelegramMasterUserAllowed(
  userId: string,
  masterTelegramUserId: string | undefined,
  allowedUserIds: string[]
): boolean {
  return (
    masterTelegramUserId !== undefined &&
    userId === masterTelegramUserId &&
    allowedUserIds.includes(userId)
  );
}

export function verifyTelegramWebAppInitData(
  initData: string,
  botToken: string,
  options: { now?: Date; maxAgeSeconds?: number } = {}
): TelegramWebAppIdentity {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    throw new Error("Telegram Mini App hash is missing or invalid.");
  }
  params.delete("hash");
  params.delete("signature");

  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => compareKeys(left, right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const expectedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest();
  const receivedHashBytes = Buffer.from(receivedHash, "hex");
  if (
    receivedHashBytes.length !== expectedHash.length ||
    !timingSafeEqual(receivedHashBytes, expectedHash)
  ) {
    throw new Error("Telegram Mini App signature is invalid.");
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate) || authDate <= 0) {
    throw new Error("Telegram Mini App auth date is invalid.");
  }
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const maxAgeSeconds = options.maxAgeSeconds ?? 3_600;
  if (authDate > nowSeconds + 30 || nowSeconds - authDate > maxAgeSeconds) {
    throw new Error("Telegram Mini App authorization has expired.");
  }

  const rawUser = params.get("user");
  if (!rawUser) {
    throw new Error("Telegram Mini App user is missing.");
  }
  const user = JSON.parse(rawUser) as { id?: unknown };
  if (
    (typeof user.id !== "number" && typeof user.id !== "string") ||
    !/^\d{1,20}$/.test(String(user.id))
  ) {
    throw new Error("Telegram Mini App user ID is invalid.");
  }

  return {
    userId: String(user.id),
    authDate
  };
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
