# Budget Bot Delivery Checklist

This file is the single source of truth for project progress. A checked item must be implemented and verified, not merely planned or scaffolded.

## Confirmed Product Decisions

- [x] Telegram is the primary user interface.
- [x] Notion is the first transaction store and human-readable ledger.
- [x] EUR is the reporting and base currency.
- [x] Inputs may use multiple fiat currencies.
- [x] Exchange rates use the transaction date.
- [x] Timezone is `Asia/Ho_Chi_Minh`.
- [x] Informal text is normalized by OpenAI before it reaches Notion.
- [x] AI-parsed transactions require confirmation before saving.
- [x] Monthly reports include category totals and a doughnut/pie chart.

## Phase 0 — Accounts and Infrastructure

- [x] Initialize the local Git repository.
- [x] Create and connect `GlebTiidt/budget-app` on GitHub.
- [x] Create `gleb-projects-work/budget-app` on Vercel.
- [x] Connect the Vercel project to the GitHub repository.
- [x] Register Telegram bot `@budgetgleb_bot`.
- [x] Add `TELEGRAM_BOT_TOKEN` to `.env.local` without posting it in chat; verify it with Telegram `getMe`.
- [ ] Add `TELEGRAM_BOT_TOKEN` to Vercel environment variables.
- [x] Determine the owner's numeric Telegram user ID (`742932409`) and add it to local `TELEGRAM_ALLOWED_USER_IDS`.
- [ ] Add `TELEGRAM_ALLOWED_USER_IDS` to Vercel environment variables.

Exit condition: the bot token and owner allowlist are configured in both environments without any secret entering Git.

## Phase 1 — Personal Accounting Rules

- [ ] Confirm the currencies used in daily life.
- [ ] Confirm expense categories.
- [ ] Confirm income categories.
- [ ] Confirm accounts, such as cards and cash wallets.
- [ ] Decide whether transfers between personal accounts are included in the first version.
- [ ] Provide 10 representative Telegram transaction messages, including slang and abbreviations.
- [ ] Decide whether raw Telegram text is stored privately for audit or discarded after confirmation.

Exit condition: currencies, categories, accounts, transfer policy, examples, and raw-text policy are documented.

## Phase 2 — Notion Ledger

- [ ] Create the `Транзакции` database in Notion.
- [ ] Add the agreed schema: title, date, direction, original amount, original currency, EUR rate, EUR amount, category, account, note, Telegram message ID, and created time.
- [ ] Create month, category, income, and expense views.
- [x] Create a private Notion integration with read, insert, and update content access; verify its token with Notion `users/me`.
- [ ] Share only the budget page/database with that integration.
- [ ] Add `NOTION_API_KEY` and `NOTION_BUDGET_DATABASE_ID` locally and in Vercel.
- [ ] Implement the Notion transaction mapper and repository.
- [ ] Verify an idempotent test write and delete the test row manually.

Exit condition: one verified transaction can be written exactly once through the repository.

## Phase 3 — OpenAI Text Processing

- [x] Add the official OpenAI JavaScript SDK.
- [x] Add a structured-output parser for amount, currency, direction, date, category, account, description, confidence, and ambiguities.
- [x] Prevent the parser from writing directly to Notion.
- [ ] Create or open an OpenAI API Platform account and enable API billing.
- [ ] Create a project API key; do not reuse or expose ChatGPT credentials.
- [ ] Add `OPENAI_API_KEY` locally and in Vercel.
- [ ] Test the parser against the 10 representative messages.
- [ ] Add deterministic fallback/error messages for incomplete or ambiguous input.
- [ ] Implement Confirm, Correct, and Cancel actions in Telegram.

Exit condition: every sample produces a valid draft or a clear clarification request, and nothing is saved before confirmation.

## Phase 4 — Currency Conversion

- [ ] Implement the Frankfurter client without an API key.
- [ ] Convert from the original currency to EUR using the transaction date.
- [ ] Use rate `1` for EUR transactions.
- [ ] Define weekend/holiday behavior using the latest available prior rate.
- [ ] Store original amount, currency, rate date, applied rate, and EUR amount.
- [ ] Add tests for EUR, USD, VND or another daily currency, and a non-trading day.

Exit condition: tested conversions are deterministic and retain all audit fields.

## Phase 5 — Telegram Transaction Flow

- [ ] Wire grammY to the configured bot token.
- [ ] Reject every Telegram user not present in `TELEGRAM_ALLOWED_USER_IDS`.
- [ ] Implement `/start` and `/help`.
- [ ] Parse an informal message through OpenAI.
- [ ] Show the normalized draft and confirmation buttons.
- [ ] Convert the confirmed amount to EUR.
- [ ] Save the confirmed transaction to Notion.
- [ ] Prevent duplicate writes using the Telegram message ID.
- [ ] Return a concise receipt containing original amount, EUR amount, category, account, and date.

Exit condition: one real Telegram message completes the full confirmed path into Notion exactly once.

## Phase 6 — Monthly Reports and Charts

- [x] Add a QuickChart PNG renderer for EUR totals by category.
- [ ] Query confirmed Notion transactions for a selected month.
- [ ] Aggregate expenses by category in application code.
- [ ] Implement `/month` summary text.
- [ ] Implement `/chart` doughnut chart and send the PNG to Telegram.
- [ ] Add income-versus-expense totals and remaining balance.
- [ ] Handle an empty month without generating a misleading chart.
- [ ] Optionally add an interactive Chart.js dashboard on Vercel after the Telegram report is stable.

Exit condition: the bot returns verified monthly totals and a chart whose segments match those totals.

## Phase 7 — Tests, Deployment, and Operations

- [ ] Add unit tests for config, validation, AI result normalization, conversion, aggregation, and chart configuration.
- [ ] Add integration tests with mocked OpenAI, Frankfurter, Notion, QuickChart, and Telegram responses.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Add the Telegram webhook HTTP endpoint for Vercel.
- [ ] Configure all production environment variables in Vercel.
- [ ] Deploy to Vercel and register the Telegram webhook.
- [ ] Perform an end-to-end production smoke test.
- [ ] Verify that logs contain no tokens or sensitive budget text.
- [ ] Document token rotation and recovery steps.

Exit condition: the production bot passes the smoke test and can be safely operated and recovered.

## Current Next Actions

1. Complete the remaining Phase 0 secret and Telegram user-ID setup.
2. Supply the Phase 1 lists, examples, transfer policy, and raw-text preference.
3. Create the Phase 2 Notion database and private integration.
