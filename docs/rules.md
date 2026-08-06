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
- Notion is the first accounting backend and should remain human-readable.
- Avoid overbuilding until a real workflow proves the need.
- Finish and validate the Telegram workflow before starting the native iOS implementation.
- Treat Telegram and the future SwiftUI app as clients of one server-side budget domain, not as separate accounting systems.

## Data Rules

- Every transaction must have direction and date. Amount and currency may be missing only in an incomplete draft and are required before saving.
- Direction is either `expense`, `income`, or `transfer`.
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
- The opening balance is a controlled EUR setting with an effective date; it is not recorded as a fake income transaction.
- The personal MVP tracks one total EUR balance rather than separate per-account balances.
- Transfers between supported personal accounts are first-class transactions. A transfer stores both its source account and destination account and requires confirmation before saving.
- Every confirmed transaction stores `Остаток EUR`, the running balance immediately after that operation.
- For the total balance, income adds the converted EUR amount, expense subtracts it, and transfers between personal accounts do not change it.
- For transaction drafts, `account` is the payment account for an expense, the receiving account for income, and the source account for a transfer; `destinationAccount` is required only for a transfer.
- Backdated inserts, corrections, and deletions require recalculation of every later running balance in deterministic date/order sequence.
- Currency conversion uses Frankfurter v2 without an API key and targets EUR. EUR-to-EUR uses rate `1` without a network request.
- Request the rate for the transaction date. Accept the API's same-day rate or the latest returned prior rate, but never a rate after the transaction date.
- Send only the current transaction text and controlled category/account lists to the language model, not the complete budget history.
- Serialize structured OpenAI input context with the official TOON encoder. Keep strict JSON Schema Structured Outputs as the validated response contract.
- Keep reusable OpenAI instructions before changing TOON input, state each rule once, and rerun the representative live parser suite after changing a prompt or reasoning setting.
- Use `reasoning.effort: none` for the GPT-5.6 budget parser while the full live suite remains green; raise it only for a measured correctness regression.
- Use `text.verbosity: low`, an `8,000`-token response ceiling, and bounded Structured Output strings for the GPT-5.6 budget parser. Change these limits only after the maximum-size structured response and live parser suite still pass.
- Keep the parser cache key `budget-parse-toon-v1` and revision cache key `budget-revise-toon-v1` separate, with an explicit breakpoint after reusable developer instructions and before changing TOON data. Bump the key version when the reusable prompt contract changes materially.
- The current verified token baseline is 13 live requests: all 11 parser cases and both reply revisions passed with both `low` and `none`; `none` reduced total usage from `17,312` to `15,768` tokens (`-8.9%`). Treat this as a regression baseline, not a universal saving; full measurements and research decisions live in [`docs/token-optimization.md`](token-optimization.md).
- Log OpenAI input, cache-read, cache-write, output, reasoning, and total token counts without logging prompt or response content.
- Never add filler solely to cross the prompt-cache minimum. A shorter uncached prompt is preferred unless measured request volume and cache pricing prove otherwise.
- One Telegram text message may produce multiple transaction drafts. Resolve references and later clarifications within that message, but do not send unrelated chat history to the language model.
- A preview correction may send only the normalized current preview and the user's direct reply to the language model; never include unrelated messages or raw history.
- The preview, direct reply, controlled catalogs, timestamp, and timezone are serialized into one TOON input document for correction requests.
- In preview replies, a standalone `тоже` repeats the most recent field assignment for the next unresolved item in preview order, continuing from transactions to balance observations.
- If money passes through an unsupported wallet before reaching a supported account, use the supported final destination as the account and keep the intermediate route only as additional note context.
- Keep every extracted transaction as an independent draft with its own direction, amount, currency, date, category, account, confidence, and ambiguities.
- A stated current or remaining balance is a balance observation, not a transaction, and must never be silently converted into income or expense.
- Timezone defaults to `Asia/Ho_Chi_Minh` unless explicitly changed.
- The MVP uses the transaction date to request the historical rate and stores the applied rate; it does not expose a separate rate-date property in Notion.
- The MVP does not store a `Source` property because Telegram is the only input source.
- The MVP relies on Notion's built-in page creation metadata instead of a visible `Created` property.
- The current account list is `Наличные`, `Карта`, `Сбережения`, `Вьетнамский счёт`, and `Crypto`.
- Vietnamese QR payments use `Вьетнамский счёт`; cryptocurrency holdings, wallets, and payments use `Crypto`; `Наличные` is reserved for physical cash.
- The current currency list is `USD`, `RUB`, `VND`, `AUD`, and `EUR`.
- A user may report an observed current balance for a named account in a supported currency. The application converts that observation to EUR for comparison with the calculated balance but does not store it as income or expense. Account-specific reconciliation does not change the MVP decision to report one total EUR balance.
- When an observed balance is below the calculated balance, the bot starts a reconciliation conversation in plain, non-judgmental language, states the difference, and invites the user to recall missing expenses.
- Reconciliation may produce one or more post-factum drafts. Every draft requires normal validation and independent confirmation, and the bot shows the remaining unexplained difference after each confirmed expense.
- The bot must never invent a missing expense or silently create a balancing adjustment. The user may stop reconciliation with an unresolved difference.

## Telegram Rules

- Only allow configured Telegram user IDs.
- Bot replies must sound like a concise, supportive conversation with a trusted companion: use ordinary first-person language, ask natural questions, and avoid robotic headings, bookkeeping jargon, or command-manual phrasing when a plain explanation works.
- Bot replies must remain short and action-oriented; warmth must not obscure amounts, currencies, dates, account routes, uncertainty, or the next action.
- Render Telegram previews as escaped HTML: make section headings, amount-plus-currency values, and categories bold, and escape every model-derived description, note, category, account, and ambiguity before sending it to Telegram.
- Parsing failures should ask for a corrected message instead of silently guessing.
- Show all drafts and balance observations from one user message in one numbered Telegram preview and manage it through a normal text reply, without an inline button grid.
- Collect missing amount, currency, category, account, and other ambiguities into one numbered clarification block instead of sending separate prompts.
- Never truncate or replace any preview, clarification, comment, or ambiguity with an ellipsis when the complete message fits Telegram's 4,096-character limit. Compact content only after the complete preview actually exceeds that hard limit, while preserving every numbered item, every missing-field request, the reply instructions, and the no-write warning.
- Destructive actions must require explicit confirmation.

### Parser Preview Mode

- The deployed preview is owner-only and exists to test Telegram delivery, language, parsing quality, and draft controls before enabling financial writes.
- Every preview draft and action response must state that nothing was written to Notion.
- Reply actions such as `всё верно`, field corrections, and `отмени 4` exercise preview UX only; they must not call currency conversion or any repository write.
- Committed tests and fixtures must use synthetic examples and must never contain credentials, API keys, personal identifiers, or real financial history.
- Application logs must not contain raw Telegram transaction text. An exact user phrase may be used transiently for debugging only and must be removed after a synthetic regression case reproduces it.
- Do not mark the full Telegram transaction flow complete until one real Telegram message passes confirmation, conversion, an idempotent Notion write, and a verified receipt.

## Notion Rules

- Keep Notion database schema stable and documented.
- Prefer explicit properties over packed JSON text fields.
- All Notion writes should be idempotent when possible.
- Store integration IDs or source hashes to prevent duplicate transactions.
- The current Notion workspace is the owner's private ledger. Never write another user's transactions or settings into it.

## Multi-User Rules

- Adding a Telegram ID is not sufficient multi-user support; access must include onboarding, revocation, authorization, and isolated storage.
- Do not use a local text, JSON, or SQLite file on Vercel as the persistent multi-user database.
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
- Store production secrets in Vercel environment variables.
- Never ship Telegram, Notion, OpenAI, Vercel, or currency-provider secrets inside an iOS application bundle.
- Prefer Apple on-device speech recognition for the future iOS client when the target locale and device support it.
- Raw voice recordings are deleted after transcription by default and are never written to logs.
- A multi-operation Telegram text creates multiple drafts, and every draft requires independent validation and confirmation.
- A daily voice note may create multiple drafts, but every draft requires independent validation and confirmation.
- Optimize cost by shortening repeated prompts, using structured outputs, and measuring actual usage; do not sacrifice transaction correctness merely to reduce token count.
