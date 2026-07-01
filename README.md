# Budget App

Personal budget app that will start as a Telegram bot and use Notion for accounting and reports.

## Current Shape

- `src/budget` contains budget domain logic: transactions, categories, accounts, rules.
- `src/integrations/telegram` contains Telegram bot entrypoints and command handlers.
- `src/integrations/notion` contains Notion client and page/database mapping code.
- `src/storage` contains persistence adapters.
- `src/config` contains environment parsing and app settings.
- `docs/rules.md` is the living development rules file.

## Planned Flow

1. User sends an expense or income message to Telegram.
2. Telegram adapter parses the message into a budget command.
3. Budget domain validates and normalizes the transaction.
4. Notion integration writes the transaction to the selected database.
5. Bot replies with the saved result and useful context.

## Local Setup

Copy `.env.example` to `.env.local` and fill values when the integrations are ready.

```bash
npm install
npm run dev
```

The project currently contains scaffolding only. Dependencies will be added when we implement the first working bot flow.
