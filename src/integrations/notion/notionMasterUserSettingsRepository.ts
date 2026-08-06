import {
  isSupportedCurrency,
  type UserSettings,
  type UserSettingsRepository
} from "../../budget/userSettings.js";

type NotionMasterUserSettingsRepositoryOptions = {
  apiKey: string;
  dataSourceId: string;
  masterTelegramUserId: string;
  fetchImpl?: typeof fetch;
};

const NOTION_VERSION = "2026-03-11";

export function createNotionMasterUserSettingsRepository(
  options: NotionMasterUserSettingsRepositoryOptions
): UserSettingsRepository {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async findByTelegramUserId(telegramUserId) {
      requireMasterUser(telegramUserId, options.masterTelegramUserId);
      const matches = await querySettings(
        fetchImpl,
        options.apiKey,
        options.dataSourceId,
        telegramUserId
      );
      if (matches.length === 0) {
        return null;
      }
      if (matches.length > 1) {
        throw new Error("Notion contains duplicate master settings rows.");
      }
      return mapSettings(matches[0], telegramUserId);
    },

    async save(settings) {
      requireMasterUser(settings.telegramUserId, options.masterTelegramUserId);
      const matches = await querySettings(
        fetchImpl,
        options.apiKey,
        options.dataSourceId,
        settings.telegramUserId
      );
      if (matches.length > 1) {
        throw new Error("Notion contains duplicate master settings rows.");
      }

      const properties = notionSettingsProperties(settings);
      const existingPageId = readPageId(matches[0]);
      const url = existingPageId
        ? `https://api.notion.com/v1/pages/${encodeURIComponent(existingPageId)}`
        : "https://api.notion.com/v1/pages";
      const response = await fetchImpl(url, {
        method: existingPageId ? "PATCH" : "POST",
        headers: notionHeaders(options.apiKey),
        body: JSON.stringify(
          existingPageId
            ? { properties }
            : {
                parent: {
                  type: "data_source_id",
                  data_source_id: options.dataSourceId
                },
                properties
              }
        )
      });
      if (!response.ok) {
        throw new Error(
          `Notion master settings write failed (${response.status}): ${await readNotionError(response)}`
        );
      }
    }
  };
}

async function querySettings(
  fetchImpl: typeof fetch,
  apiKey: string,
  dataSourceId: string,
  telegramUserId: string
): Promise<unknown[]> {
  const response = await fetchImpl(
    `https://api.notion.com/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`,
    {
      method: "POST",
      headers: notionHeaders(apiKey),
      body: JSON.stringify({
        filter: {
          property: "Telegram ID",
          rich_text: { equals: telegramUserId }
        },
        page_size: 2
      })
    }
  );
  if (!response.ok) {
    throw new Error(
      `Notion master settings query failed (${response.status}): ${await readNotionError(response)}`
    );
  }
  const body = (await response.json()) as { results?: unknown[] };
  if (!Array.isArray(body.results)) {
    throw new Error("Notion master settings query returned invalid results.");
  }
  return body.results;
}

function mapSettings(value: unknown, telegramUserId: string): UserSettings {
  const page = asRecord(value);
  const properties = asRecord(page?.properties);
  const currencyProperty = asRecord(properties?.["Основная валюта"]);
  const selected = asRecord(currencyProperty?.select);
  const currency = selected?.name;
  const helpProperty = asRecord(properties?.["Подсказки показаны"]);
  if (typeof currency !== "string" || !isSupportedCurrency(currency)) {
    throw new Error("Notion master settings contain an invalid currency.");
  }

  return {
    telegramUserId,
    baseCurrency: currency,
    onboardingHelpShown: helpProperty?.checkbox === true
  };
}

function notionSettingsProperties(settings: UserSettings) {
  return {
    Пользователь: {
      type: "title",
      title: [{ type: "text", text: { content: "Мастер-аккаунт" } }]
    },
    "Telegram ID": {
      type: "rich_text",
      rich_text: [
        { type: "text", text: { content: settings.telegramUserId } }
      ]
    },
    "Основная валюта": {
      type: "select",
      select: { name: settings.baseCurrency }
    },
    "Подсказки показаны": {
      type: "checkbox",
      checkbox: settings.onboardingHelpShown
    }
  };
}

function notionHeaders(apiKey: string) {
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "notion-version": NOTION_VERSION
  };
}

function readPageId(value: unknown): string | null {
  const page = asRecord(value);
  return typeof page?.id === "string" ? page.id : null;
}

function requireMasterUser(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error("Notion master settings are restricted to the master user.");
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readNotionError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message?.trim() || response.statusText || "unknown error";
  } catch {
    return response.statusText || "unknown error";
  }
}
