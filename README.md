# Budget App

Personal budget app that will start as a Telegram bot and use Notion for accounting and reports.

## Current Shape

- `src/budget` contains budget domain logic: transactions, categories, accounts, rules.
- `src/integrations/telegram` contains Telegram bot entrypoints and command handlers.
- `src/integrations/notion` contains Notion client and page/database mapping code.
- `src/storage` contains persistence adapters.
- `src/config` contains environment parsing and app settings.
- `docs/rules.md` is the living development rules file.
- `docs/checklist.md` is the required delivery sequence and status source.

## Planned Flow

1. User sends an expense or income message to Telegram.
2. Telegram adapter parses the message into a budget command.
3. OpenAI turns informal text into a structured draft.
4. The bot asks the user to confirm or correct the draft.
5. Budget domain validates, converts, and normalizes the transaction.
6. Notion integration writes the transaction to the selected database.
7. Bot replies with the saved result and can render category reports through QuickChart.

## Local Setup

Copy `.env.example` to `.env.local` and fill values when the integrations are ready.

```bash
npm install
npm run dev
```

The project currently contains scaffolding only. Dependencies will be added when we implement the first working bot flow.

Keep `TELEGRAM_BOT_TOKEN`, `NOTION_API_KEY`, and `OPENAI_API_KEY` in `.env.local` locally and in Vercel environment variables in production. Never commit or paste those values into issues or chat messages.
