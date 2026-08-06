import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  isSupportedCurrency,
  type UserSettings,
  type UserSettingsRepository
} from "../budget/userSettings.js";

type UserSettingsRow = {
  telegram_user_id: string;
  base_currency: string;
  onboarding_help_shown: number;
};

export type SqliteUserSettingsRepository = UserSettingsRepository & {
  close(): void;
};

export function createSqliteUserSettingsRepository(
  databasePath: string
): SqliteUserSettingsRepository {
  const normalizedPath = databasePath.trim();
  if (!normalizedPath) {
    throw new Error("USER_DATABASE_PATH must not be empty.");
  }

  const filename =
    normalizedPath === ":memory:" ? normalizedPath : resolve(normalizedPath);
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const database = new DatabaseSync(filename);
  database.exec("PRAGMA foreign_keys = ON;");
  if (filename !== ":memory:") {
    database.exec("PRAGMA journal_mode = WAL;");
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      telegram_user_id TEXT PRIMARY KEY,
      base_currency TEXT NOT NULL,
      onboarding_help_shown INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
  `);

  const findStatement = database.prepare(`
    SELECT telegram_user_id, base_currency, onboarding_help_shown
    FROM user_settings
    WHERE telegram_user_id = ?
  `);
  const saveStatement = database.prepare(`
    INSERT INTO user_settings (
      telegram_user_id,
      base_currency,
      onboarding_help_shown
    ) VALUES (?, ?, ?)
    ON CONFLICT (telegram_user_id) DO UPDATE SET
      base_currency = excluded.base_currency,
      onboarding_help_shown = excluded.onboarding_help_shown,
      updated_at = CURRENT_TIMESTAMP
  `);

  return {
    async findByTelegramUserId(telegramUserId) {
      validateTelegramUserId(telegramUserId);
      const row = findStatement.get(telegramUserId) as
        | UserSettingsRow
        | undefined;
      if (!row) {
        return null;
      }
      if (!isSupportedCurrency(row.base_currency)) {
        throw new Error("Stored user base currency is not supported.");
      }

      return {
        telegramUserId: row.telegram_user_id,
        baseCurrency: row.base_currency,
        onboardingHelpShown: row.onboarding_help_shown === 1
      };
    },

    async save(settings) {
      validateTelegramUserId(settings.telegramUserId);
      if (!isSupportedCurrency(settings.baseCurrency)) {
        throw new Error("User base currency is not supported.");
      }
      saveStatement.run(
        settings.telegramUserId,
        settings.baseCurrency,
        settings.onboardingHelpShown ? 1 : 0
      );
    },

    close() {
      database.close();
    }
  };
}

function validateTelegramUserId(value: string): void {
  if (!/^\d{1,20}$/.test(value)) {
    throw new Error("Telegram user ID must contain only digits.");
  }
}
