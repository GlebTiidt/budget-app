# Token Optimization Decision

This document records the token-cost decisions for the budget parser. Correct amounts, currencies, dates, and account routes take precedence over a lower token count.

## Applied

- Use `gpt-5.6-luna`, the OpenAI model intended for cost-sensitive, high-volume work.
- Send one structured request for all operations in a Telegram message instead of one request per transaction.
- Serialize only the changing context as TOON and keep strict JSON Schema output.
- Keep repeated instructions lean, stable, and before changing user data.
- Use `reasoning.effort: none`, `text.verbosity: low`, bounded schema strings, and an 8,000-token output ceiling.
- Record API-reported input, cache-read, cache-write, output, reasoning, and total token usage. Never log prompt or response content.
- Keep separate stable cache keys and explicit breakpoints for parse and revise requests. Do not pad the reusable prefix merely to reach the cache minimum.

The representative live suite on 2026-08-04 produced these results:

| Configuration | Passed | Input | Output | Reasoning | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| `reasoning: low` | 11/11 + 2 revisions | 13,602 | 3,710 | 1,335 | 17,312 |
| `reasoning: none` | 11/11 + 2 revisions | 13,434 | 2,334 | 0 | 15,768 |

`none` used 1,544 fewer total tokens (`-8.9%`) with no failure in the representative suite. Output tokens include reasoning tokens, so reasoning is shown as a subset for diagnosis.

Prompt-cache reads and writes were both zero. The complete parse requests were about 975–1,046 input tokens, but their stable prefix ended below OpenAI's 1,024-token minimum; revision requests were larger only because the changing preview was longer. Artificial padding would increase every request and is not justified for a low-volume personal bot with a 30-minute cache TTL.

The debt-aware structured contract and prompt-cache `v2` were verified on 2026-08-08. All 12 parser cases and both reply revisions passed with `reasoning: none`. Across 14 requests, the API reported 18,323 input tokens, 12,232 cached input tokens (`66.8%` of input), 1,112 cache-write tokens, 2,601 output tokens, zero reasoning tokens, and 20,924 total tokens. The prefix crossed the cache threshold because the required debt rules and schema grew materially; no filler was added.

The independently numbered debt-section contract and prompt-cache `v3` were verified on 2026-08-08. All 12 parser cases, both transaction reply revisions, and the new `долг 1: счёт Сбережения` revision passed with `reasoning: none`. Across 15 requests, the API reported 19,630 input tokens, 12,232 cached input tokens (`62.3%` of input), 1,112 cache-write tokens, 2,869 output tokens, zero reasoning tokens, and 22,499 total tokens.

The multi-wallet contract added a thirteenth parse case and a fourth revision fixture. All 13 parse cases passed, including three same-date wallet observations. One mass-account revision exposed a model-generated transfer whose source and destination were identical; the domain normalizer now drops this impossible no-op and the Notion repository rejects it. The final `v5` revision run passed all four fixtures with 6,921 total tokens and zero reasoning tokens. The delivered parser therefore keeps wallet corrections, debt numbering, mass account assignment, and genuine two-account transfers green.

## Official OpenAI Guidance Used

- [GPT-5.6 guidance](https://developers.openai.com/api/docs/guides/latest-model): prefer lean prompts, choose reasoning effort through representative evaluations, and measure cache reads and writes.
- [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching): exact prefixes matter, reusable content goes first, and caching begins at 1,024 tokens.
- [Cost optimization](https://developers.openai.com/api/docs/guides/cost-optimization): reduce requests and input/output tokens, and use a smaller model when quality is verified.
- [Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization): shorter outputs and fewer model requests usually provide the largest gains.
- [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna): supports Responses, Structured Outputs, and prompt caching and is optimized for cost-sensitive workloads.

## External Tools Evaluated

| Tool | Potential value | Decision for this project |
| --- | --- | --- |
| [TOON](https://github.com/toon-format/toon) | Compact, deterministic structured input. | Adopted for changing parser and revision context. |
| [Microsoft LLMLingua](https://github.com/microsoft/LLMLingua) | Lossy prompt compression aimed at long context and RAG; reports compression up to 20×. | Not used for transaction text. Removing or altering one digit, currency, negation, or account is an unacceptable accounting risk, and the Python/model runtime is disproportionate here. |
| [OpenAI tiktoken](https://github.com/openai/tiktoken) | Fast offline token estimation. | Useful for experiments, but not added to the production path. API `usage` is authoritative and already measures cache and reasoning tokens. |
| [Promptfoo](https://github.com/promptfoo/promptfoo) | Repeatable prompt/model evaluations and comparisons. | Revisit when the fixture suite or model matrix grows. The existing TypeScript live verifier currently covers 12 parser cases, including debt operations, and two revision cases without another dependency. |
| [LiteLLM](https://github.com/BerriAI/litellm) | Multi-provider gateway, routing, caching, budgets, and cost tracking. | Not added while the app has one provider, one model family, and one owner. A proxy adds operations and another trust boundary without reducing this prompt's tokens. |

Semantic response caching is intentionally excluded: two financially different messages can be linguistically similar, and returning a cached amount or account route would be unsafe. Reconsider compression or gateway layers only for long read-only context, multi-provider routing, or a substantially larger evaluation/observability workload.
