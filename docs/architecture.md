# Architecture Notes

## Boundaries

- `app`: process entrypoint and composition root.
- `budget`: core domain types and rules.
- `integrations`: external APIs such as Telegram and Notion.
- `reports`: deterministic report datasets and chart rendering.
- `storage`: persistence abstractions and adapters.
- `config`: environment-backed settings.

## Dependency Direction

`app` may depend on every module. Integrations may depend on `budget` and `config`. The budget domain should not depend on integrations.

## First Milestone

Implement one complete path:

```text
Telegram text -> OpenAI structured draft -> user confirmation -> validation -> currency conversion -> Notion row -> Telegram confirmation
```

Reports query already converted EUR values from Notion. The application aggregates totals itself and uses QuickChart only to render a PNG; the language model is never used for arithmetic.
