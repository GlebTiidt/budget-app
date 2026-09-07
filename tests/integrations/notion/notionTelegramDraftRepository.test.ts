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

test("reply to an intermediate page resolves the active full draft, excluding obsolete pages", async () => {
  let calls = 0;
  const draft = { ...pendingDraft(), serializedDraft: JSON.stringify({ currentPreviewMessageIds: [18,19,20], previewMessageIds: [5,18,19,20] }) };
  const repository = createNotionTelegramDraftRepository({ apiKey: "synthetic", dataSourceId: "drafts", fetchImpl: async () => {
    calls++;
    return Response.json({ results: calls % 2 ? [] : [notionDraftPage(draft)], has_more: false });
  } });
  assert.equal((await repository.find("100001",18))?.previewMessageId,20);
  assert.equal(await repository.find("100001",5),null);
});

test("latest pending draft query scopes chat, owner, expiry and active status", async () => {
  let query: any;
  const repository = createNotionTelegramDraftRepository({ apiKey: "synthetic", dataSourceId: "draft-source", fetchImpl: async (_url, init) => {
    query = JSON.parse(String(init?.body));
    return Response.json({ results: [notionDraftPage(pendingDraft())] });
  } });
  assert.equal((await repository.findLatest!("100001", "100001"))?.sourceMessageId, 10);
  assert.deepEqual(query.filter.and.slice(0, 2), [{ property: "Chat ID", rich_text: { equals: "100001" } }, { property: "Telegram ID пользователя", rich_text: { equals: "100001" } }]);
  assert.ok(query.filter.and[2].date.after);
  assert.equal(query.sorts[0].direction, "descending");
});

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
        ].filter(item => item.plain_text.length > 0)
      },
      "Истекает": { date: { start: draft.expiresAt } }
    }
  };
}

function richText(value: string) {
  return { rich_text: [{ plain_text: value }] };
}
