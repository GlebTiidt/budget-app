# Architecture Notes

## Boundaries

- `app`: process entrypoint and composition root.
- `budget`: core domain types and rules.
- `integrations`: external APIs such as Telegram, Notion, OpenAI, and Frankfurter.
- `reports`: deterministic report datasets and chart rendering.
- `storage`: planned persistence abstractions and adapters; add them with the first verified repository implementation.
- `config`: environment-backed settings.
- `clients`: Telegram is the MVP client; a future SwiftUI app calls the same server-side application boundary.

## Dependency Direction

`app` may depend on every module. Integrations may depend on `budget` and `config`. The budget domain should not depend on integrations.

## First Milestone

Implement one complete path:

```text
Telegram text -> OpenAI structured drafts -> independent confirmation -> validation -> currency conversion -> Notion rows -> Telegram confirmation
```

A single Telegram message may yield multiple ordered transaction drafts plus separate balance observations. The Telegram client renders them in one numbered preview with one clarification block. The user manages the preview by replying with ordinary text; a correction request sends only that normalized preview and direct reply back through the structured parser. Every transaction is still reviewed independently, and a balance observation is never treated as income or expense.

Dynamic OpenAI input context is serialized with the official TOON encoder: current text or normalized preview, the direct correction reply, controlled catalogs, timestamp, and timezone. OpenAI still returns strict JSON Schema Structured Outputs, which application code validates before Telegram sees them. Personal transfers use `account` as the source and `destinationAccount` as the receiver; they do not change the one total EUR balance.

The OpenAI boundary keeps static developer instructions before changing TOON data, uses separate stable cache keys for parsing and revision, and records only aggregate token usage. GPT-5.6 requests use `reasoning.effort: none`, low text verbosity, and an output cap after the representative live suite showed no quality regression versus `low`. Explicit cache breakpoints prevent changing user data from becoming a paid cache write; the current reusable prefix is intentionally not padded to reach the 1,024-token cache threshold.

Reports query already converted EUR values from Notion. The application aggregates totals itself and uses QuickChart only to render a PNG; the language model is never used for arithmetic.

Frankfurter v2 provides the historical rate without a project API key. The converter sends the transaction date, converts into EUR in application code, uses rate `1` for EUR, and rejects a returned rate dated after the transaction.

## Future Client and Voice Path

```text
iOS microphone -> Apple on-device transcription (preferred) -> text
                                                        |
                                                        v
                                      server-side structured parser
                                                        |
Telegram text ------------------------------------------+
                                                        |
                                                        v
                              confirmation -> conversion -> Notion
```

If on-device recognition is unavailable or insufficient, the iOS client uploads only the captured clip to a server-side transcription endpoint. API keys remain on Vercel. A daily note is parsed into multiple drafts, but each draft follows the same confirmation and validation path as an immediate transaction.
