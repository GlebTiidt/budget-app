import assert from "node:assert/strict";
import test from "node:test";
import {
  createNotionTelegramDraftRepository,
  type PendingTelegramDraft
} from "../../../src/integrations/notion/notionTelegramDraftRepository.js";

test("persists a normalized pending draft and reloads it by preview message", async () => {
  const requests: Array<{ url: string; method: string; body: any }> = [];
  const draft = pendingDraft();
  const repository = createNotionTelegramDraftRepository({
    apiKey: "notion-secret",
    dataSourceId: "draft-source",
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      if (requests.length === 1) {
        return Response.json({ results: [] });
      }
      return Response.json({ id: "draft-page" });
    }
  });

  assert.deepEqual(await repository.save(draft), {
    ...draft,
    pageId: "draft-page"
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0]!.body.filter, {
    and: [
      { property: "Chat ID", rich_text: { equals: "100001" } },
      { property: "Preview сообщение ID", number: { equals: 20 } }
    ]
  });
  assert.equal(requests[1]!.body.properties["Данные"].rich_text.length, 2);
});

test("loads and trashes a persisted pending draft", async () => {
  const draft = pendingDraft();
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const repository = createNotionTelegramDraftRepository({
    apiKey: "notion-secret",
    dataSourceId: "draft-source",
    fetchImpl: async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      if (calls.length === 1) {
        return Response.json({ results: [notionDraftPage(draft)] });
      }
      return Response.json({ id: "draft-page", in_trash: true });
    }
  });

  assert.deepEqual(await repository.find("100001", 20), {
    ...draft,
    pageId: "draft-page"
  });
  await repository.trash("draft-page");
  assert.equal(calls[1]!.url, "https://api.notion.com/v1/pages/draft-page");
  assert.equal(calls[1]!.method, "PATCH");
  assert.deepEqual(calls[1]!.body, { in_trash: true });
});

function pendingDraft(): PendingTelegramDraft {
  return {
    telegramUserId: "100001",
    chatId: "100001",
    sourceMessageId: 10,
    previewMessageId: 20,
    serializedDraft: "x".repeat(2_100),
    expiresAt: "2026-08-09T08:00:00.000Z"
  };
}

function notionDraftPage(draft: PendingTelegramDraft) {
  return {
    id: "draft-page",
    properties: {
      "Telegram ID пользователя": richText(draft.telegramUserId),
      "Chat ID": richText(draft.chatId),
      "Исходное сообщение ID": { number: draft.sourceMessageId },
      "Preview сообщение ID": { number: draft.previewMessageId },
      "Данные": {
        rich_text: [
          { plain_text: draft.serializedDraft.slice(0, 1_900) },
          { plain_text: draft.serializedDraft.slice(1_900) }
        ]
      },
      "Истекает": { date: { start: draft.expiresAt } }
    }
  };
}

function richText(value: string) {
  return { rich_text: [{ plain_text: value }] };
}
