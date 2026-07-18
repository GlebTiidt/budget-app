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
- [x] Telegram remains the MVP client; a native iOS app is a later client of the same budget backend.
- [x] The future iOS client will be built in Xcode with SwiftUI and its own design system.
- [x] Voice input is a future feature, with on-device Apple transcription preferred when available.

## Phase 0 — Accounts and Infrastructure

- [x] Initialize the local Git repository.
- [x] Create and connect `GlebTiidt/budget-app` on GitHub.
- [x] Create `gleb-projects-work/budget-app` on Vercel.
- [x] Connect the Vercel project to the GitHub repository.
- [x] Configure a valid Vercel output directory and verify a production deployment with status `Ready`.
- [x] Register Telegram bot `@budgetgleb_bot`.
- [x] Add `TELEGRAM_BOT_TOKEN` to `.env.local` without posting it in chat; verify it with Telegram `getMe`.
- [x] Add `TELEGRAM_BOT_TOKEN` to Vercel Production and Development environment variables.
- [x] Determine the owner's numeric Telegram user ID (`742932409`) and add it to local `TELEGRAM_ALLOWED_USER_IDS`.
- [x] Add `TELEGRAM_ALLOWED_USER_IDS` to Vercel Production and Development environment variables.

Exit condition: the bot token and owner allowlist are configured in both environments without any secret entering Git.

## Phase 1 — Personal Accounting Rules

- [x] Confirm the initial currencies: `USD`, `RUB`, `VND`, `AUD`, and `EUR`.
- [x] Confirm the initial expense categories: `Кот`, `Еда`, `Транспорт`, `Жильё`, `Подписки`, `Здоровье`, `Развлечения`, `Покупки`, `Другое`, `Кофешоп`, `Еда вне дома`, and `Спорт`.
- [x] Confirm income categories: `Фриланс` and `Работа`.
- [x] Treat fuel and bike rental as `Транспорт`; preserve `Бензин` and `Аренда байка` in the comment instead of creating categories.
- [x] Confirm the initial accounts: `Наличные`, `Карта`, and `Сбережения`.
- [ ] Enter the opening total balance in EUR and the date from which balance tracking begins.
- [ ] Decide whether the MVP tracks one total EUR balance or separate balances for each account.
- [ ] Decide whether transfers between personal accounts are included in the first version.
- [ ] Provide 10 representative Telegram transaction messages, including slang and abbreviations.
- [ ] Decide whether raw Telegram text is stored privately for audit or discarded after confirmation.

Exit condition: currencies, categories, accounts, opening-balance policy, transfer policy, examples, and raw-text policy are documented.

## Phase 2 — Notion Ledger

- [x] Create the `Транзакции` database in Notion and verify API access.
- [x] Add and verify the MVP schema: `Операция`, `Дата`, `Тип`, `Исходная сумма`, `Валюта`, `Курс к EUR`, `Сумма EUR`, `Категория`, `Счёт`, `Комментарий`, and `Telegram ID`.
- [ ] Add and verify the number property `Остаток EUR` containing the running balance after each transaction.
- [ ] Store the opening EUR balance and its effective date in a single controlled settings location, not as an ordinary expense or income.
- [ ] Create month, category, income, and expense views.
- [x] Create a private Notion integration with read, insert, and update content access; verify its token with Notion `users/me`.
- [x] Share the `Личный бюджет` page and nested `Транзакции` database with that integration; verify read access.
- [x] Add local `NOTION_API_KEY`, `NOTION_BUDGET_DATABASE_ID`, and `NOTION_BUDGET_DATA_SOURCE_ID` values and verify them.
- [x] Add `NOTION_API_KEY`, `NOTION_BUDGET_DATABASE_ID`, and `NOTION_BUDGET_DATA_SOURCE_ID` to Vercel Production and Development.
- [x] Synchronize Notion categories `Фриланс`, `Работа`, and `Спорт`; keep fuel and bike rental under `Транспорт`.
- [ ] Implement the Notion transaction mapper and repository.
- [ ] Verify an idempotent test write and delete the test row manually.

Exit condition: one verified transaction can be written exactly once through the repository with its resulting EUR balance.

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
- [ ] Implement a proposed-new-category state with Create, Use `Другое`, and Cancel actions.
- [ ] Append a confirmed category to Notion while preserving all existing select options and rejecting duplicates.

Exit condition: every sample produces a valid draft or a clear clarification request, and nothing is saved before confirmation.

## Phase 4 — Currency Conversion

- [x] Implement the Frankfurter v2 client without an API key.
- [x] Convert from the original currency to EUR using the transaction date.
- [x] Use rate `1` for EUR transactions.
- [x] Define weekend/holiday behavior: accept the same-day rate when provided, otherwise the latest available prior rate; reject future rates.
- [x] Return original amount, currency, transaction date, applied rate, rate date, and EUR amount for the Notion mapper.
- [x] Add tests for EUR, USD, VND, and a non-trading day.

Exit condition: tested conversions are deterministic and retain all audit fields.

## Phase 5 — Telegram Transaction Flow

- [ ] Wire grammY to the configured bot token.
- [ ] Reject every Telegram user not present in `TELEGRAM_ALLOWED_USER_IDS`.
- [ ] Implement `/start` and `/help`.
- [ ] Parse an informal message through OpenAI.
- [ ] Show the normalized draft and confirmation buttons.
- [ ] Convert the confirmed amount to EUR.
- [ ] Calculate `Остаток EUR` after every confirmed transaction: income adds, expense subtracts, and a transfer does not change the total balance.
- [ ] Recalculate the affected running balances after a backdated transaction is inserted, corrected, or deleted.
- [ ] Save the confirmed transaction to Notion.
- [ ] Prevent duplicate writes using the Telegram message ID.
- [ ] Return a concise receipt containing original amount, EUR amount, remaining EUR balance, category, account, and date.

Exit condition: one real Telegram message completes the full confirmed path into Notion exactly once.

## Phase 6 — Monthly Reports and Charts

- [x] Add a QuickChart PNG renderer for EUR totals by category.
- [ ] Query confirmed Notion transactions for a selected month.
- [ ] Aggregate expenses by category in application code.
- [ ] Implement `/month` summary text.
- [ ] Implement `/chart` doughnut chart and send the PNG to Telegram.
- [ ] Add income-versus-expense totals and remaining balance.
- [ ] Show the latest verified `Остаток EUR` as the current available total.
- [ ] Handle an empty month without generating a misleading chart.
- [ ] Optionally add an interactive Chart.js dashboard on Vercel after the Telegram report is stable.

Exit condition: the bot returns verified monthly totals and a chart whose segments match those totals.

## Phase 7 — Tests, Deployment, and Operations

- [ ] Add unit tests for config, validation, AI result normalization, conversion, aggregation, and chart configuration.
- [ ] Add running-balance tests for income, expense, transfer, same-day ordering, and backdated corrections.
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

## Phase 8 — Native iOS Client (Future)

- [ ] Choose the minimum supported iOS version after reviewing current device requirements.
- [ ] Create a separate Xcode/SwiftUI app target without moving backend domain logic into the client.
- [ ] Define the visual language, design tokens, navigation, transaction composer, confirmation sheet, history, and reports.
- [ ] Add a private authenticated API surface on Vercel for the iOS client.
- [ ] Keep Telegram, Notion, OpenAI, and currency-provider secrets on the server; never embed them in the app bundle.
- [ ] Implement text transaction entry using the same backend validation and confirmation rules as Telegram.
- [ ] Implement monthly history and chart views using server-provided normalized data.
- [ ] Add Keychain-backed client credentials and secure session handling.
- [ ] Add iOS unit, UI, accessibility, and offline/error-state tests.

Exit condition: the iOS app can safely create and review the same transactions as Telegram without containing server secrets.

## Phase 9 — Voice and Multi-Transaction Capture (Future)

- [ ] Prototype Apple Speech/SpeechAnalyzer transcription and confirm supported Russian and English behavior on the target devices.
- [ ] Prefer on-device transcription when supported; use `gpt-4o-mini-transcribe` only as an accuracy or compatibility fallback.
- [ ] Add microphone and speech-recognition permission descriptions and request access only when the user starts voice input.
- [ ] Support both one-operation dictation and a daily note containing multiple operations.
- [ ] Parse a daily note into an array of independent structured drafts.
- [ ] Require per-operation review, correction, and confirmation before saving the daily batch.
- [ ] Delete raw audio after successful transcription by default; retain it only through an explicit opt-in.
- [ ] Record transcription duration and OpenAI usage without logging audio or sensitive text.
- [ ] Compare measured cost and accuracy of immediate entries versus one daily note before choosing a default.

Exit condition: voice capture is private, measurable, and every extracted transaction is individually reviewable before saving.

## Current Next Actions

1. Provide the opening EUR balance and effective date; decide whether the balance is total or per account.
2. Decide transfer handling and raw-text retention; supply 10 representative Telegram messages.
3. Add `Остаток EUR`, create the remaining Notion views, and implement the first verified repository write.
4. Create and add the OpenAI API key, then test structured parsing before wiring the full Telegram flow.
5. Wire the tested EUR converter and running-balance calculation into the confirmed Telegram transaction flow.
6. Keep Phases 8–9 parked until the Telegram MVP completes its production smoke test.
