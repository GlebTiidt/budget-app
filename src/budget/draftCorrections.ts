import type { ParsedBudgetMessageDraft } from "../integrations/openai/openAiTransactionParser.js";

export function isUncategorizedReply(text: string): boolean {
  return /^(?:нет категории|без категории|категории нет|не знаю категорию|не помню(?: категорию)?|(?:пусть будет |поставь )?другое)[.!?]?$/iu.test(text.trim());
}

export function applyUncategorizedReply(draft: ParsedBudgetMessageDraft, text: string): ParsedBudgetMessageDraft | null {
  if (!isUncategorizedReply(text)) return null;
  return {
    ...draft,
    transactions: draft.transactions.map(item => item.direction === "expense" && item.category === null ? {
      ...item, category: "Другое", ambiguities: item.ambiguities.filter(a => !/категор|category/iu.test(a))
    } : item),
    ambiguities: draft.ambiguities.filter(a => !/категор|category/iu.test(a))
  };
}
