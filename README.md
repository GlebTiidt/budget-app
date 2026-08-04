# Budget App

Personal budget app with an owner-only Telegram parser preview and a planned confirmed write flow into Notion.

## Current Shape

- `src/budget` contains current domain primitives and controlled catalogs.
- `src/integrations/telegram` contains the owner-only preview bot and message formatting.
- `src/integrations/openai` contains structured text parsing; it never writes directly to Notion.
- `src/integrations/currency` contains deterministic Frankfurter-to-EUR conversion.
- `src/config` contains environment parsing and app settings.
- `docs/rules.md` is the living development rules file.
- `docs/checklist.md` is the required delivery sequence and status source.

## Target Flow

1. User sends one or more expenses, incomes, transfers, or a balance observation to Telegram.
2. Telegram adapter parses the message into a budget command.
3. OpenAI turns informal text into ordered structured drafts and separates balance observations from transactions.
4. The bot asks the user to confirm or correct every draft independently.
5. Budget domain validates, converts, and normalizes the transaction.
6. Notion integration writes the transaction to the selected database.
7. Bot replies with the saved result and can render category reports through QuickChart.

## Local Setup

Copy `.env.example` to `.env.local` and configure the integrations used by the selected command.

```bash
npm install
npm run dev
```

The project has verified configuration, multi-operation structured parsing, chart rendering, and currency-conversion building blocks. The end-to-end Telegram confirmation and Notion write flow is the next implementation milestone.

Keep `TELEGRAM_BOT_TOKEN`, `NOTION_API_KEY`, and `OPENAI_API_KEY` in `.env.local` locally and in Vercel environment variables in production. Never commit or paste those values into issues or chat messages.
