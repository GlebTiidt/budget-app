export type PendingTelegramDraft = {
  telegramUserId: string;
  chatId: string;
  sourceMessageId: number;
  previewMessageId: number;
  serializedDraft: string;
  expiresAt: string;
};

export type StoredTelegramDraft = PendingTelegramDraft & {
  pageId: string;
};

export type TelegramDraftRepository = {
  save(draft: PendingTelegramDraft): Promise<StoredTelegramDraft>;
  find(chatId: string, previewMessageId: number): Promise<StoredTelegramDraft | null>;
  trash(pageId: string): Promise<void>;
};

type NotionTelegramDraftRepositoryOptions = {
  apiKey: string;
  dataSourceId: string;
  fetchImpl?: typeof fetch;
};

const NOTION_VERSION = "2026-03-11";
const RICH_TEXT_CHUNK_SIZE = 1_900;

export function createNotionTelegramDraftRepository(
  options: NotionTelegramDraftRepositoryOptions
): TelegramDraftRepository {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async save(draft) {
      validateDraft(draft);
      const existing = await findDraft(fetchImpl, options, draft.chatId, draft.previewMessageId);
      if (existing) {
        return existing;
      }
      const response = await fetchImpl("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: notionHeaders(options.apiKey),
        body: JSON.stringify({
          parent: {
            type: "data_source_id",
            data_source_id: options.dataSourceId
          },
          properties: draftProperties(draft)
        })
      });
      if (!response.ok) {
        throw new Error(
          `Notion Telegram draft write failed (${response.status}): ${await readNotionError(response)}`
        );
      }
      const page = (await response.json()) as { id?: unknown };
      if (typeof page.id !== "string" || !page.id) {
        throw new Error("Notion Telegram draft write returned no page ID.");
      }
      return { ...draft, pageId: page.id };
    },

    async find(chatId, previewMessageId) {
      return findDraft(fetchImpl, options, chatId, previewMessageId);
    },

    async trash(pageId) {
      if (!pageId.trim()) {
        throw new Error("Notion Telegram draft page ID is required.");
      }
      const response = await fetchImpl(
        `https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`,
        {
          method: "PATCH",
          headers: notionHeaders(options.apiKey),
          body: JSON.stringify({ in_trash: true })
        }
      );
      if (!response.ok) {
        throw new Error(
          `Notion Telegram draft cleanup failed (${response.status}): ${await readNotionError(response)}`
        );
      }
    }
  };
}

async function findDraft(
  fetchImpl: typeof fetch,
  options: NotionTelegramDraftRepositoryOptions,
  chatId: string,
  previewMessageId: number
): Promise<StoredTelegramDraft | null> {
  validateMessageIdentity(chatId, previewMessageId);
  const response = await fetchImpl(
    `https://api.notion.com/v1/data_sources/${encodeURIComponent(options.dataSourceId)}/query`,
    {
      method: "POST",
      headers: notionHeaders(options.apiKey),
      body: JSON.stringify({
        filter: {
          and: [
            { property: "Chat ID", rich_text: { equals: chatId } },
            {
              property: "Preview сообщение ID",
              number: { equals: previewMessageId }
            }
          ]
        },
        page_size: 2
      })
    }
  );
  if (!response.ok) {
    throw new Error(
      `Notion Telegram draft query failed (${response.status}): ${await readNotionError(response)}`
    );
  }
  const body = (await response.json()) as { results?: unknown };
  if (!Array.isArray(body.results)) {
    throw new Error("Notion Telegram draft query returned an invalid result list.");
  }
  if (body.results.length > 1) {
    throw new Error("Notion contains duplicate Telegram draft preview IDs.");
  }
  return body.results[0] ? mapStoredDraft(body.results[0]) : null;
}

function mapStoredDraft(value: unknown): StoredTelegramDraft {
  const page = requireRecord(value, "draft page");
  const properties = requireRecord(page.properties, "draft properties");
  const pageId = requireString(page.id, "draft page ID");
  const telegramUserId = readRichText(properties["Telegram ID пользователя"]);
  const chatId = readRichText(properties["Chat ID"]);
  const sourceMessageId = readNumber(properties["Исходное сообщение ID"]);
  const previewMessageId = readNumber(properties["Preview сообщение ID"]);
  const serializedDraft = readRichText(properties["Данные"]);
  const expiresAt = readDate(properties["Истекает"]);
  const draft = {
    pageId,
    telegramUserId,
    chatId,
    sourceMessageId,
    previewMessageId,
    serializedDraft,
    expiresAt
  };
  validateDraft(draft);
  return draft;
}

function draftProperties(draft: PendingTelegramDraft) {
  return {
    "Черновик": titleProperty(`Telegram ${draft.chatId}:${draft.previewMessageId}`),
    "Telegram ID пользователя": richTextProperty(draft.telegramUserId),
    "Chat ID": richTextProperty(draft.chatId),
    "Исходное сообщение ID": { number: draft.sourceMessageId },
    "Preview сообщение ID": { number: draft.previewMessageId },
    "Данные": richTextProperty(draft.serializedDraft),
    "Истекает": { date: { start: draft.expiresAt } },
    "Статус": { select: { name: "Активен" } }
  };
}

function titleProperty(value: string) {
  return {
    title: [{ type: "text", text: { content: value } }]
  };
}

function richTextProperty(value: string) {
  return {
    rich_text: chunkText(value).map((content) => ({
      type: "text",
      text: { content }
    }))
  };
}

function chunkText(value: string): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += RICH_TEXT_CHUNK_SIZE) {
    chunks.push(value.slice(index, index + RICH_TEXT_CHUNK_SIZE));
  }
  return chunks;
}

function readRichText(value: unknown): string {
  const property = requireRecord(value, "rich text property");
  if (!Array.isArray(property.rich_text)) {
    throw new Error("Notion Telegram draft contains invalid rich text.");
  }
  return property.rich_text
    .map((item) => requireString(requireRecord(item, "rich text item").plain_text, "rich text"))
    .join("");
}

function readNumber(value: unknown): number {
  const property = requireRecord(value, "number property");
  if (!Number.isSafeInteger(property.number) || Number(property.number) < 0) {
    throw new Error("Notion Telegram draft contains an invalid message ID.");
  }
  return Number(property.number);
}

function readDate(value: unknown): string {
  const property = requireRecord(value, "date property");
  const date = requireRecord(property.date, "date value");
  return requireString(date.start, "draft expiry");
}

function validateDraft(draft: PendingTelegramDraft): void {
  if (!/^\d{1,20}$/.test(draft.telegramUserId)) {
    throw new Error("Telegram draft user ID is invalid.");
  }
  validateMessageIdentity(draft.chatId, draft.previewMessageId);
  if (!Number.isSafeInteger(draft.sourceMessageId) || draft.sourceMessageId < 0) {
    throw new Error("Telegram draft source message ID is invalid.");
  }
  if (!draft.serializedDraft.trim()) {
    throw new Error("Telegram draft data is required.");
  }
  if (!Number.isFinite(Date.parse(draft.expiresAt))) {
    throw new Error("Telegram draft expiry must be an ISO timestamp.");
  }
}

function validateMessageIdentity(chatId: string, previewMessageId: number): void {
  if (!/^-?\d{1,20}$/.test(chatId)) {
    throw new Error("Telegram draft chat ID is invalid.");
  }
  if (!Number.isSafeInteger(previewMessageId) || previewMessageId < 0) {
    throw new Error("Telegram draft preview message ID is invalid.");
  }
}

function notionHeaders(apiKey: string) {
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "notion-version": NOTION_VERSION
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Notion Telegram ${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`Notion Telegram ${label} is invalid.`);
  }
  return value;
}

async function readNotionError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message?.trim() || response.statusText || "unknown error";
  } catch {
    return response.statusText || "unknown error";
  }
}
