import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTokenOptimizedInput,
  summarizeOpenAiTokenUsage
} from "../../../src/integrations/openai/openAiTokenOptimization.js";

test("uses an explicit stable-prefix cache and no reasoning for GPT-5.6", () => {
  const request = buildTokenOptimizedInput({
    model: "gpt-5.6-luna",
    operation: "parse",
    instructions: "stable instructions",
    input: "changing TOON input"
  });

  assert.equal(request.prompt_cache_key, "budget-parse-toon-v6");
  assert.deepEqual(request.prompt_cache_options, {
    mode: "explicit",
    ttl: "30m"
  });
  assert.deepEqual(request.reasoning, {
    effort: "none",
    context: "current_turn"
  });
  assert.equal(request.max_output_tokens, 8_000);

  const input = request.input;
  assert.ok(Array.isArray(input));
  const developerMessage = input[0];
  const userMessage = input[1];
  assert.ok(developerMessage && "content" in developerMessage);
  assert.ok(userMessage && "content" in userMessage);
  assert.deepEqual(developerMessage.content, [
    {
      type: "input_text",
      text: "stable instructions",
      prompt_cache_breakpoint: { mode: "explicit" }
    }
  ]);
  assert.deepEqual(userMessage.content, [
    { type: "input_text", text: "changing TOON input" }
  ]);
});

test("keeps automatic cache compatibility without GPT-5.6-only fields", () => {
  const request = buildTokenOptimizedInput({
    model: "gpt-4.1-mini",
    operation: "revise",
    instructions: "stable instructions",
    input: "changing input",
    reasoningEffort: "medium"
  });

  assert.equal(request.prompt_cache_key, "budget-revise-toon-v6");
  assert.equal(request.prompt_cache_options, undefined);
  assert.equal(request.reasoning, undefined);
  assert.ok(Array.isArray(request.input));
  const developerMessage = request.input[0];
  assert.ok(developerMessage && "content" in developerMessage);
  assert.deepEqual(developerMessage.content, [
    { type: "input_text", text: "stable instructions" }
  ]);
});

test("summarizes API usage without prompt or response content", () => {
  const summary = summarizeOpenAiTokenUsage("parse", "gpt-5.6-luna", {
    input_tokens: 1_500,
    input_tokens_details: {
      cached_tokens: 1_100,
      cache_write_tokens: 0
    },
    output_tokens: 250,
    output_tokens_details: { reasoning_tokens: 80 },
    total_tokens: 1_750
  });

  assert.deepEqual(summary, {
    operation: "parse",
    model: "gpt-5.6-luna",
    inputTokens: 1_500,
    cachedInputTokens: 1_100,
    cacheWriteTokens: 0,
    outputTokens: 250,
    reasoningTokens: 80,
    totalTokens: 1_750
  });
});
