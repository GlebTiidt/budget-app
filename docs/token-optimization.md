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
| [Promptfoo](https://github.com/promptfoo/promptfoo) | Repeatable prompt/model evaluations and comparisons. | Revisit when the fixture suite or model matrix grows. The existing TypeScript live verifier currently covers the 11 parser and two revision cases without another dependency. |
| [LiteLLM](https://github.com/BerriAI/litellm) | Multi-provider gateway, routing, caching, budgets, and cost tracking. | Not added while the app has one provider, one model family, and one owner. A proxy adds operations and another trust boundary without reducing this prompt's tokens. |

Semantic response caching is intentionally excluded: two financially different messages can be linguistically similar, and returning a cached amount or account route would be unsafe. Reconsider compression or gateway layers only for long read-only context, multi-provider routing, or a substantially larger evaluation/observability workload.
