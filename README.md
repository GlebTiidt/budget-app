# Budget App

Personal budget app with an owner-only Telegram workflow and confirmed writes into Notion.

## Current Shape

- `src/budget` contains current domain primitives and controlled catalogs.
- `src/integrations/telegram` contains the owner-only bot, persistent confirmation flow, message cleanup, and formatting.
- `src/integrations/openai` contains structured text parsing; it never writes directly to Notion.
- OpenAI prompt data uses TOON for compact structured input and strict JSON Schema for validated output.
- `src/integrations/currency` contains deterministic Frankfurter conversion into a user's selected base currency.
- `src/storage` contains user-scoped persistence adapters and the normalized filesystem fallback for failed Notion writes; the dedicated-server adapter uses one SQLite database.
- `src/reports` and `api/reports.ts` build the owner-only monthly report from Notion after signed Telegram Mini App authorization.
- `public/reports.html` is the animated Chart.js report with month and chart-type selection.
- `src/config` contains environment parsing and app settings.
- `docs/rules.md` is the living development rules file.
- `docs/checklist.md` is the required delivery sequence and status source.

## Target Flow

1. User sends one or more expenses, incomes, transfers, debt actions, or a balance observation to Telegram.
2. Telegram adapter parses the message into a budget command.
3. OpenAI turns informal text into ordered structured drafts and separates debt operations and balance observations from ordinary transactions.
4. The bot numbers transaction and debt drafts, shows an observed balance once in the summary, keeps debt grouped by counterparty and original currency, and accepts confirmation, correction, or cancellation as a normal text reply.
5. The application validates each confirmed item, converts it to the user's selected base currency (USD for the master account), and calculates the anchored running balance; pre-anchor history remains analytics-only.
6. Notion integrations write transactions, debt operations, balance observations, and persistent Telegram drafts idempotently.
7. After a complete save the bot removes the source and temporary confirmation messages, retains a receipt, and keeps a normalized fallback if Notion fails.

## Local Setup

Copy `.env.example` to `.env.local` and configure the integrations used by the selected command.
Use Node.js 22.5 or newer because the dedicated-server settings adapter uses `node:sqlite`.

```bash
npm install
npm run dev
```

The project has verified configuration, multi-operation structured parsing, chart rendering, currency conversion, persistent confirmation state, and idempotent Notion repositories. The owner initializes balance tracking by confirming one balance-only Telegram message containing either one total or several named wallet balances on the same date.

For a dedicated server, set `USER_DATABASE_PATH` to a file on a persistent volume. One SQLite database stores all user profiles as isolated rows keyed by Telegram ID; do not point it at an ephemeral container directory. See [`docs/server-storage.md`](docs/server-storage.md).

Keep `TELEGRAM_BOT_TOKEN`, `NOTION_API_KEY`, and `OPENAI_API_KEY` in `.env.local` locally and in the active server's environment or secret manager in production. `USER_DATABASE_PATH` must point to a persistent server volume. Never commit or paste secret values into issues or chat messages.
