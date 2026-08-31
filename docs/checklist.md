# Budget Bot Delivery Checklist

This file is the single source of truth for project progress. A checked item must be implemented and verified, not merely planned or scaffolded.

## Confirmed Product Decisions

- [x] Telegram is the primary user interface.
- [x] Keep current interaction testing inside the Telegram bot; do not require a new internal application interface for currency selection or debt previews.
- [x] Keep Telegram's native mobile menu control; do not duplicate it with a custom hamburger in the report Mini App while there is no separate in-app navigation.
- [x] Notion is the master's private transaction store and human-readable ledger; every other user must use isolated application storage.
- [x] Every user has one base/reporting currency selected during onboarding; the supported initial choices are `USD`, `RUB`, `VND`, `AUD`, and `EUR`.
- [x] Search for the base currency in the bot by code or familiar Russian name; show inline choices only when a search has multiple matches.
- [x] Inputs may use multiple fiat currencies.
- [x] Exchange rates use the transaction date.
- [x] Timezone is `Asia/Ho_Chi_Minh`.
- [x] Informal text is normalized by OpenAI before it reaches Notion.
- [x] AI-parsed transactions require confirmation before saving.
- [x] Monthly reports include category totals and a doughnut/pie chart.
- [x] Telegram remains the MVP client; a native iOS app is a later client of the same budget backend.
- [x] The future iOS client will be built in Xcode with SwiftUI and its own design system.
- [x] Voice input is a future feature, with on-device Apple transcription preferred when available.
- [x] A balance mismatch starts a human-language reconciliation flow for post-factum expenses; the app never invents a balancing transaction.
- [x] Treat borrowing, repayment of the user's debt, lending, and collection as four separate debt actions; keep each position by counterparty and original currency rather than converting it into the base currency.

## Phase 0 — Accounts and Infrastructure

- [x] Initialize the local Git repository.
- [x] Create and connect `GlebTiidt/budget-app` on GitHub.
- [x] Create `gleb-projects-work/budget-app` on Vercel.
- [x] Connect the Vercel project to the GitHub repository.
- [x] Configure a valid Vercel output directory and verify a production deployment with status `Ready`.
- [x] Register Telegram bot `@budgetgleb_bot`.
- [x] Add `TELEGRAM_BOT_TOKEN` to `.env.local` without posting it in chat; verify it with Telegram `getMe`.
- [x] Add `TELEGRAM_BOT_TOKEN` to Vercel Production and Development environment variables.
- [x] Determine the owner's numeric Telegram user ID and add it to local `TELEGRAM_ALLOWED_USER_IDS` without committing the value.
- [x] Add `TELEGRAM_ALLOWED_USER_IDS` to Vercel Production and Development environment variables.
- [x] Choose one dedicated server with a persistent disk as the target runtime for user settings; keep Vercel as the owner's preview rather than the user-data persistence layer.
- [ ] Provision the dedicated server, persistent volume, production `USER_DATABASE_PATH`, encrypted SQLite-safe backups, and a tested restore procedure.

Exit condition: the bot token and owner allowlist are configured in both environments without any secret entering Git.

## Phase 1 — Personal Accounting Rules

- [x] Confirm the initial currencies: `USD`, `RUB`, `VND`, `AUD`, and `EUR`.
- [x] Confirm the initial expense categories: `Кот`, `Еда`, `Транспорт`, `Жильё`, `Подписки`, `Здоровье`, `Развлечения`, `Покупки`, `Другое`, `Кофешоп`, `Еда вне дома`, and `Спорт`.
- [x] Confirm income categories: `Фриланс` and `Работа`.
- [x] Treat fuel and bike rental as `Транспорт`; preserve `Бензин` and `Аренда байка` in the comment instead of creating categories.
- [x] Confirm the accounts: `Наличные`, `Карта`, `Сбережения`, `Вьетнамский счёт`, and `Crypto`; Vietnamese QR payments use `Вьетнамский счёт`, and cryptocurrency holdings, wallets, and payments use `Crypto`.
- [x] Enter the opening total balance in the selected base currency and the date from which balance tracking begins: `60.31 USD` on `2026-08-31`, converted from the source observation `1,587,104 VND` at `0.000038 USD/VND` and verified in Notion as the single `Вьетнамский счёт` opening anchor.
- [x] Track one total balance in each user's selected base currency in the MVP rather than separate calculated per-account balances.
- [x] Include transfers between supported personal accounts; require a source and destination account while keeping the user's total balance unchanged.
- [x] Define debt balance behavior: borrowing and collection add available money, repayment and lending subtract it, and none of the four count as income or expense.
- [x] Set the owner's USD reconciliation tolerance to the greater of `2%` of the absolute calculated balance or `5 USD`; define equivalent floors for every supported base currency.
- [x] Provide 11 representative Telegram transaction messages, including slang, abbreviations, and a crypto-account example; keep the reproducible set in `scripts/verifyOpenAiParser.ts`.
- [x] Discard raw Telegram text after the normalized transaction is confirmed.

Exit condition: currencies, categories, accounts, opening-balance policy, transfer policy, examples, and raw-text policy are documented.

## Phase 2 — Notion Ledger

- [x] Create the `Транзакции` database in Notion and verify API access.
- [x] Add and verify the initial fixed-EUR MVP schema; preserve this as migration history.
- [x] Add and verify the initial fixed-EUR running-balance property; preserve this as migration history.
- [x] Add and verify the `Месяц` formula: current-dated rows resolve to `Текущий месяц`, while older rows resolve to `YYYY-MM`.
- [x] Migrate transaction, debt, balance, settings, and report access from fixed-EUR fields to verified generic base-currency fields; record `Основная валюта` on every derived row and switch the empty owner profile to USD.
- [x] Store the aggregate opening balance, its selected currency, and its effective date in one controlled settings row; accept one total or the converted sum of several same-date wallet observations without fabricating income.
- [x] Store each confirmed wallet balance observation separately from transactions, including its account, original currency, base-currency amount, calculated total, accepted total, difference, tolerance, and an explicit anchor flag set only on the final row of a complete snapshot.
- [x] Store debt operations separately with action, counterparty, original amount, original currency, date, account, base currency, running balance, and an idempotent Telegram source ID.
- [x] Create and verify dynamic current-month views, July 2026 archive views, and calendar views for all operations, income, and expenses.
- [x] Create a private Notion integration with read, insert, and update content access; verify its token with Notion `users/me`.
- [x] Share the `Личный бюджет` page and nested `Транзакции` database with that integration; verify read access.
- [x] Add local `NOTION_API_KEY`, `NOTION_BUDGET_DATABASE_ID`, and `NOTION_BUDGET_DATA_SOURCE_ID` values and verify them.
- [x] Add `NOTION_API_KEY`, `NOTION_BUDGET_DATABASE_ID`, and `NOTION_BUDGET_DATA_SOURCE_ID` to Vercel Production and Development.
- [x] Add the verified debt, balance-observation, and Telegram-draft Notion data source IDs to Vercel Production and Development.
- [x] Synchronize Notion categories `Фриланс`, `Работа`, and `Спорт`; keep fuel and bike rental under `Транспорт`.
- [x] Synchronize the Notion account option `Crypto` while preserving every existing `Счёт` option.
- [x] Implement the Notion transaction mapper and repository.
- [x] Verify an idempotent synthetic write: the stable source ID resolved to exactly one row on repeat, then the synthetic page was moved to Notion trash.

Exit condition: one verified transaction can be written exactly once through the repository with its resulting balance in the recorded base currency.

## Phase 3 — OpenAI Text Processing

- [x] Add the official OpenAI JavaScript SDK.
- [x] Add the official TOON JavaScript encoder and serialize dynamic structured prompt context as TOON while retaining strict JSON Schema output.
- [x] Benchmark a representative six-operation prompt with the official TOON CLI: estimated input fell from about 340 JSON tokens to 207 TOON tokens (`-39.1%`); keep measuring real production usage before treating this as a universal saving.
- [x] Apply the official GPT-5.6 efficiency guidance: keep the prompt lean and stable, use `gpt-5.6-luna`, cap output, request low verbosity, and log token totals without logging budget text.
- [x] Compare `low` and `none` reasoning on all 11 live parser cases plus both reply revisions: both configurations passed; `none` reduced aggregate tokens from 17,312 to 15,768 (`-8.9%`) and is the default.
- [x] Add separate parse/revise cache keys and explicit stable-prefix breakpoints. The lean `v1` prefix stayed below 1,024 tokens without padding; the materially larger debt-aware `v2` prefix crossed the threshold naturally and produced verified cache reads.
- [x] Review TOON, LLMLingua, tiktoken, Promptfoo, and LiteLLM for this workload and document the adoption decision in [`docs/token-optimization.md`](token-optimization.md).
- [x] Add a structured-output parser for transactions and the four debt actions, including amount, original currency, date, counterparty, account, description, confidence, and ambiguities.
- [x] Parse every distinct transaction in one Telegram message into an ordered array of independent drafts.
- [x] Parse a stated current balance separately from transactions so it is never invented as income or expense.
- [x] Prevent the parser from writing directly to Notion.
- [x] Create or open an OpenAI API Platform account.
- [ ] Enable API billing and set a project budget or usage alert.
- [x] Create a project API key; do not reuse or expose ChatGPT credentials.
- [x] Add `OPENAI_API_KEY` locally and verify it with a live Responses API parser request.
- [x] Add `OPENAI_API_KEY` to Vercel Production and Development.
- [x] Deploy an owner-only Telegram parser preview that clearly states confirmations do not write to Notion.
- [x] Rerun the live parser after the debt schema and prompt-cache `v2` change: all 12 synthetic parser cases, including four debt actions in mixed currencies, plus both reply-revision cases passed; 14 requests used 20,924 total tokens with 12,232 cached input tokens.
- [x] Rerun the live parser after independent numeric debt labels and prompt-cache `v3`: all 12 parser cases, both transaction revisions, and `долг 1: счёт Сбережения` passed; 15 requests used 22,499 total tokens with 12,232 cached input tokens.
- [x] Rerun the live parser for the multi-wallet contract: all 13 parse cases passed, including a three-wallet snapshot; after adding the deterministic same-account-transfer guard, all four `v5` revision fixtures passed, including wallet correction, debt numbering, mass account assignment, and a real account transfer.
- [x] Add deterministic fallback/error messages for incomplete or ambiguous input; missing transaction amount or currency remains explicit instead of being guessed.
- [x] Show all transaction and debt drafts from one input in one Telegram preview; number each separate section from `1` without a `Д` prefix, address debt corrections as `долг N`, and do not use a permanent inline action grid.
- [x] Group ordinary Telegram preview rows as income, then expense, then personal transfer while preserving relative order within each group; keep clarification numbers aligned with the displayed rows.
- [x] Split the converted Telegram summary into readable paragraphs for income and expense, debts owed by the user, debts owed to the user, and total balance; show `Общий остаток` last.
- [x] Rewrite the combined preview in conversational Russian: show an explicit balance observation only once as `Общий остаток`, without a separate `Б1` row or account label, ask whether everything matches, and present corrections as natural examples instead of system instructions.
- [x] Render preview headings, amount-plus-currency values, and categories in bold with safely escaped Telegram HTML.
- [x] Ask for every missing amount, currency, category, or account in one numbered clarification block.
- [x] Accept ordinary reply text for whole-preview confirmation, field corrections, and numbered cancellation; return a revised preview without writing to Notion.
- [x] Apply sequential `тоже` replies through visible items, prefer a supported final destination account, and avoid duplicate missing-field questions.
- [x] Recognize a correction that describes `Crypto → Вьетнамский счёт` as a separate personal transfer instead of overwriting the income account.
- [x] Implement persistent Confirm, Correct, and Cancel state for the real save flow using normalized Notion drafts without raw Telegram text.
- [ ] Implement a proposed-new-category state with Create, Use `Другое`, and Cancel actions.
- [ ] Append a confirmed category to Notion while preserving all existing select options and rejecting duplicates.

Exit condition: every sample produces a valid draft or a clear clarification request, and nothing is saved before confirmation.

## Phase 4 — Currency Conversion

- [x] Implement the Frankfurter v2 client without an API key.
- [x] Convert from the original currency to an explicit target currency using the transaction date; Telegram supplies the user's selected base currency.
- [x] Use rate `1` for same-currency transactions.
- [x] Define weekend/holiday behavior: accept the same-day rate when provided, otherwise the latest available prior rate; reject future rates.
- [x] Return original amount, currency, transaction date, target currency, applied rate, rate date, and converted amount for storage mappers.
- [x] Exclude debt positions from reporting-currency conversion; retain and group their original currencies.
- [x] Add tests for EUR, USD, VND, and a non-trading day.

Exit condition: tested conversions are deterministic and retain all audit fields.

## Phase 5 — Telegram Transaction Flow

- [x] Add a persistent `user_settings` SQLite table keyed by Telegram user ID and isolate it behind `UserSettingsRepository`.
- [x] Add an explicit master-account repository route: only the master Telegram ID may persist its currency and onboarding flags in the private Notion `Настройки мастера` data source; other users route to SQLite.
- [x] Require an initial base-currency choice before parsing and make onboarding plus `/settings` search `USD`, `RUB`, `VND`, `AUD`, and `EUR` by code or familiar name inside Telegram.
- [x] Add `/start`, `/settings`, `/reports`, and `/help` command definitions for the Telegram menu.
- [x] Show preview income, expense, and explicit observed account balances in the user's base currency; exclude transfers and never invent a balance when none was stated.
- [x] Show debt totals grouped by original currency with a per-counterparty breakdown for both `Я должен` and `Мне должны` positions, followed by `Общий остаток` as the final summary paragraph.
- [x] Keep routine preview guidance short and move detailed correction help to onboarding and `/help`.
- [x] Wire grammY to the configured bot token.
- [x] Reject every Telegram user not present in `TELEGRAM_ALLOWED_USER_IDS`.
- [x] Implement `/start` and `/help`.
- [x] Parse an informal message through OpenAI.
- [x] Show the normalized draft and accept confirmation, corrections, or cancellation through an ordinary text reply.
- [x] Convert confirmed owner operations into the selected base currency using their transaction dates and persist the selected currency beside every derived amount; the owner now uses USD.
- [x] Calculate and show the anchored running balance after every complete current operation: income, borrowing, and collected repayments add; expense, repayment of borrowed money, and lending subtract; personal transfers do not change the total. Pre-anchor history remains analytics-only with an empty running balance.
- [ ] Recalculate the affected running balances after a backdated transaction is inserted, corrected, or deleted.
- [ ] Save the confirmed transaction to Notion.
- [x] Prevent duplicate writes using stable IDs derived from Telegram chat ID, source message ID, operation kind, and item index.
- [ ] Save confirmed debt actions idempotently and recalculate later outstanding positions for the affected counterparty and original currency after inserts, corrections, or deletions.
- [ ] Return a concise receipt containing original amount, converted base-currency amount, remaining balance, category, account route when applicable, and date.
- [x] Accept confirmed user-stated wallet balances as authoritative reconciliation observations, never as income or expense; one or several same-date observations initialize a single summed opening anchor after the production smoke test.
- [x] Compare an observation with the calculated balance using the configured FX-aware tolerance; within tolerance accept it, otherwise explain the difference and require explicit confirmation before replacing the anchor.
- [ ] Require independent confirmation for every recalled expense, show the remaining unexplained difference, and allow the user to stop without inventing an adjustment.
- [x] After the full idempotent save succeeds, delete the user's source financial message and temporary preview/correction messages while retaining the final receipt; on failure keep messages, retain the Notion draft, and write a normalized private filesystem fallback.

Exit condition: one real Telegram message completes the full confirmed path into Notion exactly once.

## Phase 6 — Monthly Reports and Charts

- [x] Select pinned self-hosted Chart.js 4.5.1 for interactive animation; its MIT license has no per-user fee.
- [x] Add a signed Telegram Mini App authorization validator and require both the explicit master ID and owner allowlist before reading report data.
- [x] Add a read-only Notion master-report repository with pagination and month filtering against the current data source API.
- [x] Aggregate daily income, expense, net difference, and expense categories in application code while excluding transfers.
- [x] Add a Telegram `/reports` entry and a Mini App with month selection plus animated bar, line, and doughnut views.
- [x] Query the master's Notion transactions for a selected month with pagination; the live August 2026 read-only smoke query succeeded with an empty result set.
- [x] Aggregate expenses by category in application code.
- [ ] Implement `/month` summary text.
- [x] Add income-versus-expense totals and net difference to the animated master report; a verified running balance remains pending.
- [ ] Show the latest verified running balance in the user's base currency as the current available total.
- [ ] Add accumulated debt positions after the verified total balance in the bot's historical text report, grouped by original currency and counterparty; do not substitute current-message preview deltas for persisted totals.
- [x] Handle an empty month with an explicit empty state instead of a misleading chart.
- [x] Add the owner-only interactive Chart.js dashboard on the personal Vercel preview; future user reports remain on the dedicated application server.
- [x] Remove the superseded QuickChart path and legacy preview-button callbacks so Chart.js and ordinary text replies remain the only active interfaces.

Exit condition: the bot returns verified monthly totals and a chart whose segments match those totals.

## Phase 7 — Tests, Deployment, and Operations

- [x] Add unit tests for config, validation, AI result normalization, conversion, aggregation, and the current Chart.js report-page contract.
- [ ] Add running-balance tests for income, expense, transfer, same-day ordering, and backdated corrections.
- [ ] Add the remaining integration tests with mocked OpenAI, Frankfurter, Notion, and Telegram responses.
- [x] Run `npm run typecheck` after the currency, settings, and master-report implementation.
- [x] Run `npm test`; all 78 current local tests pass across USD anchored balance calculation, multi-wallet opening totals, no-op transfer rejection, generic idempotent Notion repositories, persistent Telegram confirmation, cleanup, and normalized write-failure fallback.
- [x] Add the Telegram webhook HTTP endpoint for Vercel and register the production URL with Telegram.
- [x] Deploy the owner-only parser preview to Vercel Production and register its Telegram webhook.
- [x] Deploy commit `c4322c3` with owner-only confirmed Notion writes; deployment `dpl_6s23DRDPc4gEd5wVRD4dvQQTyLtd` is `Ready`, the production alias reports `service: telegram`, and Telegram reports zero pending updates and no webhook error.
- [x] Deploy commit `3992999` with generic base-currency fields, owner USD settings, multi-wallet snapshots, and explicit balance anchors; deployment `dpl_6uGZAW1Twbobj3DwJhtXnU7SBBjm` is `READY`, the production alias reports `service: telegram`, the unsigned report API returns `401`, and Telegram reports zero pending updates with no webhook error.
- [x] Deploy the owner-only Chart.js Mini App and report API to the personal Vercel surface; verify the static page returns `200`, an unsigned API request returns `401`, and a signed master request returns a valid empty August 2026 report.
- [x] Register and verify the production Telegram menu commands `/start`, `/settings`, `/reports`, and `/help`; the webhook has no pending updates or reported error.
- [ ] Perform an end-to-end production smoke test.
- [ ] Verify that logs contain no tokens or sensitive budget text.
- [ ] Document token rotation and recovery steps.

Exit condition: the production bot passes the smoke test and can be safely operated and recovered.

## Phase 8 — Native iOS Client (Future)

- [ ] Choose the minimum supported iOS version after reviewing current device requirements.
- [ ] Create a separate Xcode/SwiftUI app target without moving backend domain logic into the client.
- [ ] Define the visual language, design tokens, navigation, transaction composer, confirmation sheet, history, and reports.
- [ ] Add a private authenticated API surface on the dedicated server for the iOS client.
- [ ] Keep Telegram, Notion, OpenAI, and currency-provider secrets on the server; never embed them in the app bundle.
- [ ] Implement text transaction entry using the same backend validation and confirmation rules as Telegram.
- [ ] Implement monthly history and chart views using server-provided normalized data.
- [ ] Add Keychain-backed client credentials and secure session handling.
- [ ] Add iOS unit, UI, accessibility, and offline/error-state tests.

Exit condition: the iOS app can safely create and review the same transactions as Telegram without containing server secrets.

## Phase 9 — Voice Capture (Future)

- [ ] Prototype Apple Speech/SpeechAnalyzer transcription and confirm supported Russian and English behavior on the target devices.
- [ ] Prefer on-device transcription when supported; select a server-side fallback only after reviewing current accuracy, privacy, and cost.
- [ ] Add microphone and speech-recognition permission descriptions and request access only when the user starts voice input.
- [ ] Support both one-operation dictation and a daily note containing multiple operations.
- [ ] Parse a daily note into an array of independent structured drafts.
- [ ] Require per-operation review, correction, and confirmation before saving the daily batch.
- [ ] Delete raw audio after successful transcription by default; retain it only through an explicit opt-in.
- [ ] Record transcription duration and OpenAI usage without logging audio or sensitive text.
- [ ] Compare measured cost and accuracy of immediate entries versus one daily note before choosing a default.

Exit condition: voice capture is private, measurable, and every extracted transaction is individually reviewable before saving.

## Phase 10 — Multi-User Bot and Private Storage (Future)

Detailed future category and idea-inbox UX is captured in [`docs/ideas-checklist.md`](ideas-checklist.md); the high-level delivery status remains here.

- [ ] Decide whether access is invite-only, owner-approved, or open registration; implement access grant and revocation.
- [ ] Keep the owner's existing Notion workspace private and confirm that no other user's transactions are written there.
- [x] Choose and document the first user-settings storage strategy: one SQLite database on a dedicated server's persistent disk, one row per Telegram ID, one writer instance, and a PostgreSQL migration boundary before horizontal scaling.
- [ ] Provision and verify SQLite-safe backups and recovery on the dedicated server before treating user settings as production-ready.
- [ ] Decide whether the owner continues using Notion while other users use the database, or whether all users eventually move to one backend.
- [ ] Design user-scoped records for profiles, transactions, categories, accounts, opening balances, preferences, and Telegram identities.
- [ ] Enforce data isolation in every query and database constraint so one Telegram user can never read or modify another user's budget.
- [ ] Implement user-scoped onboarding, settings, categories, and the confirmed category-management behavior specified in [`docs/ideas-checklist.md`](ideas-checklist.md).
- [ ] Implement the owner-only idea inbox and controlled checklist-promotion workflow specified in [`docs/ideas-checklist.md`](ideas-checklist.md).
- [ ] Define whether OpenAI usage is owner-funded, quota-limited, or paid by each user; add abuse and spending limits before invitations expand.
- [ ] Add onboarding, privacy notice, data export, account deletion, and full access-revocation flows.
- [ ] Prevent sensitive transaction text and personal identifiers from entering logs, analytics, or another user's AI request.
- [ ] Add automated tenant-isolation, authorization, category-ownership, export, deletion, backup, and restore tests.
- [ ] Run a closed pilot with one invited user before allowing broader access.

Exit condition: an invited user has an isolated budget and custom categories without access to the owner's Notion or any other user's data.

## Current Gate — Confirmed Notion Save

The owner-only save flow is deployed and locally verified, and the live Notion schema uses generic base-currency fields with the owner profile set to USD. On 2026-08-31 the owner explicitly reset the ledger: the two 2026-08-08 wallet observations and their `267.11 USD` settings anchor were moved to Notion trash, all active transaction, debt, draft, observation, and settings rows were verified empty, and a new `1,587,104 VND` source observation was created for `Вьетнамский счёт` as a `60.31 USD` opening anchor using the official historical rate `0.000038 USD/VND`. Deployment `dpl_6NmJLyQXUoW61QwHgf627QYsXUTE` prevents unresolved or repeated wallet rows from reaching Notion and deterministically merges same-account rows only after explicit approval. The Telegram gate remains incomplete until the next real operation exercises the revised interaction and post-save message cleanup.

### Owner Smoke Test

- [ ] Open [`@budgetgleb_bot`](https://t.me/budgetgleb_bot) and send `/start`; verify the bot explains that confirmation writes to Notion.
- [ ] Open `/reports` from Telegram; verify the selected month shows only the master's Notion data and that bar, line, and doughnut choices animate without exposing the page outside the owner allowlist.
- [ ] Send `/help`; verify it returns concise examples and explains confirmed saving.
- [ ] Send `Сегодня заплатил 120к донгов за кофе по QR`; expect an expense in `VND`, category `Кофешоп`, account `Вьетнамский счёт`, and today's local date.
- [ ] Send an intentionally incomplete example such as `Потратил 50`; expect a clarification request or an explicit low-confidence draft with ambiguities rather than silent guessing.
- [ ] Re-test same-date wallet confirmation with synthetic amounts, verify the summed settings anchor and one observation per wallet are created idempotently, then remove the synthetic rows without resubmitting the real opening balance.
- [x] Reset the owner ledger on 2026-08-31, move the superseded two wallet observations and `267.11 USD` settings anchor to Notion trash, verify the active budget data sources are empty, and create the new `Вьетнамский счёт` opening anchor from `1,587,104 VND`, represented in the USD ledger as `60.31 USD`.
- [ ] Verify the source balance message and temporary preview disappear only after saving, while the final receipt remains.
- [ ] Send a synthetic message containing one employment income, four expenses in mixed currencies, debts, and a stated remaining balance; expect independently numbered operation/debt sections and one final balance.
- [ ] Verify that the same response shows named wallet observations as unnumbered bullets and their sum only once as the final `Общий остаток`, with no `Б1` lines and no account name in the summary label.
- [ ] Verify that missing accounts, currencies, categories, or amounts are listed together with the affected transaction numbers.
- [ ] Reply `для всех счёт Вьетнамский счёт`; expect one revised preview with that account applied to every compatible numbered item.
- [ ] Reply with a targeted correction such as `3: валюта USD`; expect unchanged items to be preserved and only item 3 updated.
- [ ] Reply with sequential lines ending in `тоже`; expect the last explicit correction to continue through each next visible ordinary or debt item, using `долг N` when directly targeting the debt section.
- [ ] Reply `отмени 4`; expect only transaction 4 to disappear from the revised preview.
- [ ] Reply `всё верно`; verify ordinary transactions, debts, and the balance observation are written once and the receipt shows the resulting balance.
- [ ] Add one transaction dated before the opening anchor; verify it appears in analytics with empty `Остаток в основной валюте` and does not change the current balance.
- [ ] Repeat the complex case with `Аванс изначально Crypto, потом перевод всей суммы на вьет счёт`; expect income on `Crypto`, a separate `Crypto → Вьетнамский счёт` transfer, all later expenses and the balance observation on `Вьетнамский счёт`, and no prematurely truncated clarification.
- [ ] Search the onboarding currency with `дол`; expect `USD` and `AUD` choices, then search `/settings` with `евро` and expect `EUR` without calling the transaction parser.
- [ ] Send one synthetic message that borrows and repays USD with one person and lends/collects another currency with another person; expect four independently numbered debt items without a `Д` prefix, no ordinary income/expense classification, and original-currency totals plus per-person breakdown before the final `Общий остаток`.
- [ ] Record any incorrect field, awkward wording, missing reply, or slow response. Share the test phrase, expected result, and actual result without any credentials.

### Follow-up

- [x] Fix the observed wallet-clarification UX, false Notion error, empty-draft persistence, and explicit one-account merge; pass 78 local tests plus typecheck/build and deploy `dpl_6NmJLyQXUoW61QwHgf627QYsXUTE`.
- [x] Remove local macOS metadata and one-off reset/runtime scripts, strip chat/message identifiers and fallback paths from operational error logs, and verify that Notion Trash has no remaining pages.
- [ ] Inspect Vercel runtime logs for webhook/OpenAI errors and confirm they contain no raw transaction text or secrets.
- [ ] Fix observed parsing or UX issues, rerun local verification, redeploy, and repeat only the failed smoke-test cases.
- [ ] Mark confirmed save behavior verified only after the real Telegram smoke test passes.

## Current Next Actions

1. Re-run the failed wallet-ambiguity interaction in Telegram with synthetic amounts, verify that confirmation is blocked until clarification and that `пусть будет один счёт` produces one summed row, then cancel the synthetic draft.
2. Confirm the next real operation through Telegram and verify that source/preview messages disappear only after the retained receipt arrives; do not resubmit the opening balances.
3. Run the mixed income, expense, debt, balance-mismatch, and pre-anchor-history production smoke cases.
4. Inspect Vercel logs for save/cleanup failures and confirm they contain no raw budget text or secrets.
5. Complete a concise receipt with per-operation original/converted details and implement recalculation for backdated rows on or after the active anchor.
6. Confirm OpenAI API billing safeguards.
7. Provision the dedicated server and persistent SQLite/failure directories with backup and restore before relying on non-master profiles.
8. Add accumulated historical debt reports.
