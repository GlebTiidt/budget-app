import type {
  ResponseCreateParamsNonStreaming,
  ResponseUsage
} from "openai/resources/responses/responses";

export type OpenAiBudgetOperation = "parse" | "revise";
export type OpenAiReasoningEffort = "none" | "low" | "medium";

export type OpenAiTokenUsage = {
  operation: OpenAiBudgetOperation;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

type TokenOptimizedInputOptions = {
  model: string;
  operation: OpenAiBudgetOperation;
  instructions: string;
  input: string;
  reasoningEffort?: OpenAiReasoningEffort;
};

type TokenOptimizedRequestFields = Pick<
  ResponseCreateParamsNonStreaming,
  | "input"
  | "max_output_tokens"
  | "prompt_cache_key"
  | "prompt_cache_options"
  | "reasoning"
>;

const MAX_BUDGET_OUTPUT_TOKENS = 8_000;
const PROMPT_CACHE_VERSION = "v2";

export function buildTokenOptimizedInput(
  options: TokenOptimizedInputOptions
): TokenOptimizedRequestFields {
  const explicitCaching = supportsExplicitPromptCaching(options.model);

  return {
    input: [
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text: options.instructions,
            ...(explicitCaching
              ? { prompt_cache_breakpoint: { mode: "explicit" as const } }
              : {})
          }
        ]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: options.input }]
      }
    ],
    max_output_tokens: MAX_BUDGET_OUTPUT_TOKENS,
    prompt_cache_key: `budget-${options.operation}-toon-${PROMPT_CACHE_VERSION}`,
    ...(explicitCaching
      ? {
          prompt_cache_options: { mode: "explicit" as const, ttl: "30m" as const },
          reasoning: {
            effort: options.reasoningEffort ?? "none",
            context: "current_turn" as const
          }
        }
      : {})
  };
}

export function summarizeOpenAiTokenUsage(
  operation: OpenAiBudgetOperation,
  model: string,
  usage?: ResponseUsage
): OpenAiTokenUsage | null {
  if (!usage) {
    return null;
  }

  return {
    operation,
    model,
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.input_tokens_details.cached_tokens,
    cacheWriteTokens: usage.input_tokens_details.cache_write_tokens,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details.reasoning_tokens,
    totalTokens: usage.total_tokens
  };
}

export function logOpenAiTokenUsage(usage: OpenAiTokenUsage): void {
  console.info(`[openai-usage] ${JSON.stringify(usage)}`);
}

function supportsExplicitPromptCaching(model: string): boolean {
  return /^gpt-5\.6(?:-|$)/.test(model);
}
