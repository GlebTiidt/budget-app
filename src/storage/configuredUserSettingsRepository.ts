import type { AppConfig } from "../config/loadConfig.js";
import type { UserSettingsRepository } from "../budget/userSettings.js";
import { createNotionMasterUserSettingsRepository } from "../integrations/notion/notionMasterUserSettingsRepository.js";
import {
  createSqliteUserSettingsRepository,
  type SqliteUserSettingsRepository
} from "./sqliteUserSettingsRepository.js";

export type ConfiguredUserSettingsRepository = UserSettingsRepository & {
  close(): void;
};

export function createConfiguredUserSettingsRepository(
  config: AppConfig
): ConfiguredUserSettingsRepository {
  const masterRepository =
    config.masterTelegramUserId &&
    config.notionApiKey &&
    config.notionMasterSettingsDataSourceId
      ? createNotionMasterUserSettingsRepository({
          apiKey: config.notionApiKey,
          dataSourceId: config.notionMasterSettingsDataSourceId,
          masterTelegramUserId: config.masterTelegramUserId
        })
      : null;
  let sqliteRepository: SqliteUserSettingsRepository | null = null;

  function repositoryFor(telegramUserId: string): UserSettingsRepository {
    if (telegramUserId === config.masterTelegramUserId) {
      if (!masterRepository) {
        throw new Error(
          "Master user settings require the private Notion settings data source."
        );
      }
      return masterRepository;
    }
    sqliteRepository ??=
      createSqliteUserSettingsRepository(config.userDatabasePath);
    return sqliteRepository;
  }

  return {
    async findByTelegramUserId(telegramUserId) {
      return repositoryFor(telegramUserId).findByTelegramUserId(telegramUserId);
    },
    async save(settings) {
      await repositoryFor(settings.telegramUserId).save(settings);
    },
    close() {
      sqliteRepository?.close();
    }
  };
}
