# Architecture Notes

## Boundaries

- `app`: process entrypoint and composition root.
- `budget`: core domain types and rules.
- `integrations`: external APIs such as Telegram and Notion.
- `storage`: persistence abstractions and adapters.
- `config`: environment-backed settings.

## Dependency Direction

`app` may depend on every module. Integrations may depend on `budget` and `config`. The budget domain should not depend on integrations.

## First Milestone

Implement one complete path:

```text
Telegram text message -> parsed transaction -> validated budget transaction -> Notion row -> Telegram confirmation
```
