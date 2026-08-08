import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFileNotionWriteFailureRepository } from "../../src/storage/fileNotionWriteFailureRepository.js";

test("writes a normalized Notion failure into a private directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "budget-notion-failure-"));
  const repository = createFileNotionWriteFailureRepository(join(root, "failures"));
  const result = await repository.save({
    telegramUserId: "10", chatId: "10", sourceMessageId: 20,
    failedAt: "2026-08-08T10:00:00.000Z", errorMessage: "Notion write failed",
    normalizedDraft: { transactions: [], debtOperations: [], balanceObservations: [], ambiguities: [] }
  });
  const body = JSON.parse(await readFile(result.path, "utf8"));
  assert.equal(body.errorMessage, "Notion write failed");
  assert.equal(body.rawText, undefined);
  assert.equal((await stat(result.path)).mode & 0o777, 0o600);
});
