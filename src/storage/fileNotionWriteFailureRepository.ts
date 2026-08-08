import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ParsedBudgetMessageDraft } from "../integrations/openai/openAiTransactionParser.js";

export type NotionWriteFailure = {
  telegramUserId: string;
  chatId: string;
  sourceMessageId: number;
  failedAt: string;
  errorMessage: string;
  normalizedDraft: ParsedBudgetMessageDraft;
};

export type NotionWriteFailureRepository = {
  save(failure: NotionWriteFailure): Promise<{ path: string }>;
};

export function createFileNotionWriteFailureRepository(
  directory: string
): NotionWriteFailureRepository {
  const absoluteDirectory = resolve(directory);
  return {
    async save(failure) {
      validateFailure(failure);
      await mkdir(absoluteDirectory, { recursive: true, mode: 0o700 });
      const timestamp = failure.failedAt.replace(/[:.]/g, "-");
      const filename = `${failure.chatId}-${failure.sourceMessageId}-${timestamp}.json`;
      const path = resolve(absoluteDirectory, filename);
      if (!path.startsWith(`${absoluteDirectory}/`)) {
        throw new Error("Notion failure path escaped its configured directory.");
      }
      await writeFile(
        path,
        `${JSON.stringify(failure, null, 2)}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 }
      );
      return { path };
    }
  };
}

function validateFailure(failure: NotionWriteFailure) {
  if (!/^\d{1,20}$/.test(failure.telegramUserId)) throw new Error("Failure Telegram user ID is invalid.");
  if (!/^-?\d{1,20}$/.test(failure.chatId)) throw new Error("Failure Telegram chat ID is invalid.");
  if (!Number.isSafeInteger(failure.sourceMessageId) || failure.sourceMessageId < 0) throw new Error("Failure source message ID is invalid.");
  if (!Number.isFinite(Date.parse(failure.failedAt))) throw new Error("Failure timestamp is invalid.");
  if (!failure.errorMessage.trim()) throw new Error("Failure error message is required.");
}
