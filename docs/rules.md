# Development Rules

This is the living rules file for the budget app. We update it when decisions become stable.

## Delivery Workflow

- `docs/checklist.md` is the single source of truth for delivery status.
- Work in checklist order and update it in the same change that completes a milestone.
- Do not mark scaffolding, configuration placeholders, or unverified external integrations as complete.
- A required item may be skipped only when it is explicitly marked blocked with a reason.
- At the start of every future work session, read `docs/checklist.md` and continue from `Current Next Actions`; update it before ending the session.

## Product Principles

- The app is personal-first: optimize for speed, low friction, and clear personal accounting.
- Telegram is the first interface for testing and daily input.
- Notion is the master's personal accounting backend and should remain human-readable. Other users must use isolated application storage.
- Avoid overbuilding until a real workflow proves the need.
- Finish and validate the Telegram workflow before starting the native iOS implementation.
- Treat Telegram and the future SwiftUI app as clients of one server-side budget domain, not as separate accounting systems.

## Data Rules

- Every transaction must have direction and date. Amount and currency may be missing only in an incomplete draft and are required before saving.
- Direction is either `expense`, `income`, or `transfer`.
- Borrowing and lending are separate debt operations, never ordinary income, expense, or personal transfer. The supported actions are `borrow`, `repay_borrowed`, `lend`, and `collect`.
- Every debt operation keeps its original amount and currency plus the person or organization involved. Debt positions are tracked by counterparty and original currency; never convert them into the reporting currency merely to combine them.
- Categories should be normalized before saving to Notion.
- The current expense category list is `Кот`, `Еда`, `Транспорт`, `Жильё`, `Подписки`, `Здоровье`, `Развлечения`, `Покупки`, `Другое`, `Кофешоп`, `Еда вне дома`, and `Спорт`.
- The income categories are `Фриланс` and `Работа`.
- Fuel and bike-rental payments use the category `Транспорт`; `Бензин` and `Аренда байка` are purposes kept in the normalized description or comment, not separate categories.
- AI must prefer an existing category. If none fits, it may suggest one normalized new category.
- A new category is added to the Notion `Категория` select only after the user confirms it in Telegram; never create categories silently.
- Category matching is case-insensitive and must reject aliases or near-duplicates of an existing category.
- When updating Notion select options, preserve every existing option and append the confirmed new option because omitted options may be removed by the API.
- Save the normalized description to Notion. The personal MVP discards raw Telegram transaction text after the normalized draft is confirmed.
- AI parsing must return structured data and must never write directly to Notion.
- A parsed transaction requires user confirmation before it is saved.
- Currency conversion and report totals are calculated by application code, not by the language model.
- Every user has exactly one selected base/reporting currency from the supported currency catalog. The user must choose it during onboarding and may change it later in Telegram settings.
- The opening balance is a controlled setting in the user's base currency with an effective date; it is not recorded as a fake income transaction.
- A confirmed balance-only message may initialize the opening balance when no anchor exists. It may contain one total observation or several wallet observations on the same date; each wallet amount is stored separately and their converted sum becomes the single opening anchor. Only the final successfully stored observation row carries the explicit anchor flag, so a partial multi-row failure cannot activate an incomplete snapshot. Transactions dated before the anchor remain valid historical records for income, expense, category, and debt analytics, but they never change the anchored current balance. Because no earlier balance is known, their running-balance field remains empty rather than showing an invented value. Transactions dated on or after the anchor date participate in the running balance.
- The personal MVP tracks one calculated total balance in the user's base currency rather than separate calculated per-account balances. Named wallet observations are reconciliation evidence and a useful breakdown, not independent running ledgers.
- Once an opening anchor and confirmed history exist, the application always calculates the current total balance itself. A preview without a user-stated balance shows the calculated balance after applying every complete operation in deterministic order.
- Transfers between supported personal accounts are first-class transactions. A transfer stores both its source account and destination account and requires confirmation before saving.
- A personal transfer must use two different supported accounts. Drop a model-generated same-account transfer as an impossible no-op and reject it again at the persistence boundary.
- Every confirmed transaction and debt operation stores the base currency used and the running balance immediately after that operation. The owner's Notion schema uses generic base-currency fields and records the selected base currency on every derived row.
- For the total balance, income adds the amount converted into the user's base currency, expense subtracts it, and transfers between personal accounts do not change it. Borrowing and collected repayments add available money; repayment of the user's debt and lending subtract it, while all four remain excluded from income and expense totals.
- For transaction drafts, `account` is the payment account for an expense, the receiving account for income, and the source account for a transfer; `destinationAccount` is required only for a transfer.
- Backdated inserts, corrections, and deletions on or after the opening anchor require recalculation of every later running balance in deterministic date/order sequence. Rows before the anchor are analytics-only and do not trigger current-balance recalculation.
- Currency conversion uses Frankfurter v2 without an API key and targets the user's selected base currency. A same-currency conversion uses rate `1` without a network request.
- Request the rate for the transaction date. Accept the API's same-day rate or the latest returned prior rate, but never a rate after the transaction date.
- Send only the current transaction text and controlled category/account lists to the language model, not the complete budget history.
- Serialize structured OpenAI input context with the official TOON encoder. Keep strict JSON Schema Structured Outputs as the validated response contract.
- Keep reusable OpenAI instructions before changing TOON input, state each rule once, and rerun the representative live parser suite after changing a prompt or reasoning setting.
- Use `reasoning.effort: none` for the GPT-5.6 budget parser while the full live suite remains green; raise it only for a measured correctness regression.
- Use `text.verbosity: low`, an `8,000`-token response ceiling, and bounded Structured Output strings for the GPT-5.6 budget parser. Change these limits only after the maximum-size structured response and live parser suite still pass.
- Keep the parser cache key `budget-parse-toon-v6` and revision cache key `budget-revise-toon-v6` separate, with an explicit breakpoint after reusable developer instructions and before changing TOON data. Bump the key version when the reusable prompt contract changes materially.
- The current purchase-direction prompt-cache `v6` verification is 18 live requests: all 14 parser cases and all four revisions passed with `reasoning.effort: none`, using 28,508 total tokens with 15,769 cached input tokens. Earlier prompt versions remain regression references, not universal savings. Full measurements live in [`docs/token-optimization.md`](token-optimization.md).
- Log OpenAI input, cache-read, cache-write, output, reasoning, and total token counts without logging prompt or response content.
- Never add filler solely to cross the prompt-cache minimum. A shorter uncached prompt is preferred unless measured request volume and cache pricing prove otherwise.
- One Telegram text message may produce multiple transaction drafts. Resolve references and later clarifications within that message, but do not send unrelated chat history to the language model.
- Purchases and payments for goods or services are expenses unless the user explicitly describes a refund, income, debt, or personal transfer. Coffee, beer, takeaway drinks, snacks, groceries, and meals remain expenses when they are entered today for an earlier date; words such as `записал` and `записывал` describe reporting, not income.
- A preview correction may send only the normalized current preview and the user's direct reply to the language model; never include unrelated messages or raw history.
- The preview, direct reply, controlled catalogs, timestamp, and timezone are serialized into one TOON input document for correction requests.
- In preview replies, a standalone `тоже` repeats the most recent field assignment for the next unresolved visible item in preview order.
- If money passes through an unsupported wallet before reaching a supported account, use the supported final destination as the account and keep the intermediate route only as additional note context.
- Keep every extracted transaction as an independent draft with its own direction, amount, currency, date, category, account, confidence, and ambiguities.
- A stated current or remaining balance is a balance observation, not a transaction, and must never be silently converted into income or expense.
- Show named wallet observations as unnumbered bullets in `Остатки по кошелькам`, then show their converted sum once as `Общий остаток` in the final summary paragraph. Do not create `Б1` preview rows or add an account name to the `Общий остаток` label.
- Timezone defaults to `Asia/Ho_Chi_Minh` unless explicitly changed.
- The MVP uses the transaction date to request the historical rate and stores the applied rate; it does not expose a separate rate-date property in Notion.
- The MVP does not store a `Source` property because Telegram is the only input source.
- The MVP relies on Notion's built-in page creation metadata instead of a visible `Created` property.
- The current account list is `Наличные`, `Карта`, `Сбережения`, `Вьетнамский счёт`, and `Crypto`.
- Vietnamese QR payments use `Вьетнамский счёт`; cryptocurrency holdings, wallets, and payments use `Crypto`; `Наличные` is reserved for physical cash.
- The current currency list is `USD`, `RUB`, `VND`, `AUD`, and `EUR`.
- The master account's current base/reporting currency is `USD`. All derived master totals, running balances, tolerances, receipts, and reports are expressed in USD. Original amounts keep their actual currencies and dates; changing the base currency never rewrites those source facts.
- A user may report observed current balances for one or several named accounts in supported currencies. Multiple observations must describe the same snapshot date, require a named account, and may not repeat the same account-and-currency pair. The application stores every observation, converts and sums them in the user's base currency for comparison with the calculated total, and never treats them as income or expense.
- Never merge repeated wallet observations silently. If the user explicitly says that same-date, same-currency rows belong to one supported account, deterministically sum those rows into one observation before showing the revised preview.
- A confirmed user-stated balance is an authoritative reconciliation observation. The tolerance is the greater of `2%` of the absolute calculated balance or the configured base-currency floor: `5 USD`, `5 EUR`, `5 AUD`, `500 RUB`, or `125,000 VND`. This accounts for differences between actual exchange execution and the official historical rate. If the values agree within tolerance, accept the observed sum as the new balance anchor. If they differ beyond tolerance, show the difference and ask about missing operations before replacing the calculated anchor; if the user explicitly confirms that nothing is missing, accept and persist the observed sum without fabricating an adjustment transaction.
- The current stateless preview shows income and expense from complete non-transfer operations in the current message only. Transfers never affect those totals. Until an opening anchor and confirmed history are connected, show a balance only from an explicit observation and never present income minus expense from one message as the user's real account balance.
- Debt summaries keep each debt in its original currency, show the combined amount grouped by currency, and show the amount for every counterparty. Show separately what the user owes and what others owe the user; never add unlike currencies together. Show the total balance as the final summary paragraph.
- Changing the base currency changes derived totals and reports for that user only. Preserve original amounts, currencies, and dates so derived values can be recalculated deterministically instead of rewriting source facts.
- When an observed balance is below the calculated balance, the bot starts a reconciliation conversation in plain, non-judgmental language, states the difference, and invites the user to recall missing expenses.
- Reconciliation may produce one or more post-factum drafts. Every draft requires normal validation and independent confirmation, and the bot shows the remaining unexplained difference after each confirmed expense.
- The bot must never invent a missing expense or silently create a balancing adjustment. The user may stop reconciliation with an unresolved difference.

## Telegram Rules

- Only allow configured Telegram user IDs.
- A user without a stored base currency must choose one before transaction parsing starts. Currency onboarding and `/settings` search by a code or familiar name in ordinary bot messages and affect only that user's profile.
- Keep `/start`, `/settings`, `/reports`, and `/help` in the Telegram command menu.
- Keep Telegram's native chat menu control. Its desktop focus outline and icon are client-owned; do not add a duplicate custom hamburger inside the report Mini App unless the product gains real in-app navigation.
- Bot replies must sound like a concise, supportive conversation with a trusted companion: use ordinary first-person language, ask natural questions, and avoid robotic headings, bookkeeping jargon, or command-manual phrasing when a plain explanation works.
- Bot replies must remain short and action-oriented; warmth must not obscure amounts, currencies, dates, account routes, uncertainty, or the next action.
- Render Telegram previews as escaped HTML: make section headings, amount-plus-currency values, and categories bold, and escape every model-derived description, note, category, account, and ambiguity before sending it to Telegram.
- Parsing failures should ask for a corrected message instead of silently guessing.
- Show all transaction and debt drafts from one user message in one Telegram preview and manage it through native `Всё верно` and `Исправить` actions or a normal text reply. Hide the confirmation action while any field remains unresolved. Number ordinary operations and debt operations independently from `1` inside their separate sections, without a `Д` prefix. A plain correction number targets `Операции`; require `долг N` or `долговая операция N` to target the independently numbered debt section. Show a balance observation only in the summary.
- In the Telegram preview, group ordinary transactions as income, then expense, then personal transfer. Preserve the original relative order inside each group, and use the displayed order consistently for item numbers and clarification references.
- Separate the converted preview summary into readable paragraphs for income and expense, what the user owes, what others owe the user, and the observed total balance. Keep the heading, labels, and counterparty rows inside their logical block, and show `Общий остаток` as the final summary paragraph.
- Collect missing amount, currency, category, account, and other ambiguities into one numbered clarification block instead of sending separate prompts.
- A preview with any unresolved field, ambiguity, mismatched balance date, or repeated account-and-currency balance must explain what remains and must not invite `всё верно` confirmation. A confirmation attempt against such a stored draft refreshes the actionable preview without calling Notion.
- Never truncate or replace any preview, clarification, comment, or ambiguity with an ellipsis when the complete message fits Telegram's 4,096-character limit. Compact content only after the complete preview actually exceeds that hard limit, while preserving every numbered item, every missing-field request, the reply instructions, and the confirmation warning.
- Destructive actions must require explicit confirmation.
- Chat cleanup happens only after every requested financial write succeeds idempotently. Then delete the user's source financial message and the bot's temporary preview/correction messages, but retain the final receipt. Never delete anything while a save is pending or failed.

### Confirmed Save Mode

- Only the explicit master Telegram ID may confirm writes into the owner's Notion workspace. Other allowlisted users remain outside this adapter and use isolated storage when that flow is enabled.
- Every normalized preview is persisted without the raw Telegram text and expires after 24 hours. Corrections create the replacement draft before the previous draft is trashed.
- `всё верно` performs deterministic conversion and idempotent Notion writes; cancellation trashes only the pending draft.
- If a Notion save fails, keep Telegram messages and the persistent Notion draft. Also write the normalized draft to the configured private failure directory and log the technical error without raw Telegram text. The Vercel `/tmp` copy is best-effort and ephemeral; persistent recovery relies on the Notion draft until a dedicated volume is deployed.
- Committed tests and fixtures must use synthetic examples and must never contain credentials, API keys, personal identifiers, or real financial history.
- Application logs must not contain raw Telegram transaction text. An exact user phrase may be used transiently for debugging only and must be removed after a synthetic regression case reproduces it.
- Do not mark the full Telegram transaction flow complete until one real Telegram message passes confirmation, conversion, an idempotent Notion write, and a verified receipt.

## Notion Rules

- Keep Notion database schema stable and documented.
- Keep all owner transactions in one Notion data source; separate months with dynamic, calendar, or fixed archive views rather than creating one database per month.
- Prefer explicit properties over packed JSON text fields.
- All Notion writes should be idempotent when possible.
- Store integration IDs or source hashes to prevent duplicate transactions.
- The current Notion workspace belongs only to the master/owner account. It is the owner's private ledger and read-only source for the owner's visual reports. Never write or expose another user's transactions, settings, or reports through it.
- Every endpoint that reads the owner's report data must validate signed Telegram Mini App `initData` on the server, reject expired signatures, require an exact match with `MASTER_TELEGRAM_USER_ID`, and also enforce `TELEGRAM_ALLOWED_USER_IDS` before querying Notion.

## Multi-User Rules

- Adding a Telegram ID is not sufficient multi-user support; access must include onboarding, revocation, authorization, and isolated storage.
- The planned production runtime is a dedicated server with a persistent disk; Vercel remains a personal preview surface and is not the persistence layer for user settings.
- Store small user-profile data in one SQLite database on the server's persistent volume, with one row keyed by Telegram user ID. Do not create a separate JSON or database file per user.
- The master account is the only exception: its small settings row lives in the owner's private Notion workspace so the owner's personal Vercel preview can retain currency and onboarding preferences. Route this adapter only for the explicit master Telegram ID and fail closed if its Notion settings source is missing; never fall back to ephemeral or shared storage for the master. Every other user remains on isolated application storage.
- A single-file SQLite deployment must run as one application instance with controlled backups. Migrate to a network database before adding multiple writers or horizontally scaled instances.
- Every transaction, category, account, balance, and preference must be owned by exactly one authenticated user and scoped in every query.
- User-created categories belong only to that user; creating or editing one must never change the owner's Notion options or another user's categories.
- Multi-user OpenAI usage requires per-user rate limits and a documented spending policy before access is expanded.
- The storage adapter must preserve the option to keep the owner on Notion while invited users use a separate managed database.

## Engineering Rules

- Keep domain logic in `src/budget` independent from Telegram and Notion.
- Integrations convert external payloads into domain commands and back.
- Config must be read through `src/config`, not directly from `process.env` across the app.
- Add tests around parsing, categorization, and duplicate prevention before expanding behavior.
- Keep secrets out of git. Use `.env.local` for local credentials.
- Store production secrets in environment variables or the secret manager of the active server. Existing Vercel secrets apply only to the personal preview deployment.
- Never ship Telegram, Notion, OpenAI, Vercel, or currency-provider secrets inside an iOS application bundle.
- Prefer Apple on-device speech recognition for the future iOS client when the target locale and device support it.
- Raw voice recordings are deleted after transcription by default and are never written to logs.
- A multi-operation Telegram text creates multiple drafts, and every draft requires independent validation and confirmation.
- A daily voice note may create multiple drafts, but every draft requires independent validation and confirmation.
- Optimize cost by shortening repeated prompts, using structured outputs, and measuring actual usage; do not sacrifice transaction correctness merely to reduce token count.
- Aggregate report totals deterministically in application code. Report queries and Chart.js rendering must not call OpenAI or send budget history to a language model.
- Use the pinned self-hosted Chart.js build for animated master-account charts. Keep the core report available without a per-user visualization fee; if a future external chart provider charges by user or request, its incremental features belong behind a paid plan and must not remove the free core report.
- Keep Chart.js as the single active chart renderer. Do not retain an unused hosted or static chart integration alongside it.
