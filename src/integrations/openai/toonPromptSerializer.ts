import { encode } from "@toon-format/toon";

export type ToonPromptContext = {
  currentTimestamp: string;
  timezone: string;
  categories: readonly string[];
  accounts: readonly string[];
  currencies: readonly string[];
};

type ParsePromptData = ToonPromptContext & {
  currentMessage: string;
};

type RevisionPromptData = ToonPromptContext & {
  currentPreviewLines: string[];
  userReplyLines: string[];
};

export function serializeParsePromptToToon(data: ParsePromptData): string {
  return wrapToonData({
    context: selectContext(data),
    catalogs: selectCatalogs(data),
    currentMessage: data.currentMessage
  });
}

export function serializeRevisionPromptToToon(
  data: RevisionPromptData
): string {
  return wrapToonData({
    context: selectContext(data),
    catalogs: selectCatalogs(data),
    currentPreviewLines: data.currentPreviewLines,
    userReplyLines: data.userReplyLines
  });
}

export function encodeToonData(value: unknown): string {
  return encode(value, { delimiter: "\t" });
}

function wrapToonData(value: unknown): string {
  return ["```toon", encodeToonData(value), "```"].join("\n");
}

function selectContext(data: ToonPromptContext) {
  return {
    currentTimestamp: data.currentTimestamp,
    timezone: data.timezone
  };
}

function selectCatalogs(data: ToonPromptContext) {
  return {
    categories: data.categories,
    accounts: data.accounts,
    currencies: data.currencies
  };
}
