# Architecture Notes

## Boundaries

- `app`: process entrypoint and composition root.
- `budget`: core domain types and rules.
- `integrations`: external APIs such as Telegram, Notion, OpenAI, and Frankfurter.
- `reports`: deterministic report datasets and chart rendering.
- `storage`: persistence abstractions and adapters.
- `config`: environment-backed settings.
- `clients`: Telegram is the MVP client; a future SwiftUI app calls the same server-side application boundary.

## Dependency Direction

`app` may depend on every module. Integrations may depend on `budget` and `config`. The budget domain should not depend on integrations.

## First Milestone

Implement one complete path:

```text
Telegram text -> OpenAI structured draft -> user confirmation -> validation -> currency conversion -> Notion row -> Telegram confirmation
```

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
