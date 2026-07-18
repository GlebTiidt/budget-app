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

- Every transaction must have amount, currency, direction, date, and source.
- Direction is either `expense`, `income`, or `transfer`.
- Categories should be normalized before saving to Notion.
- The current expense category list is `Кот`, `Еда`, `Транспорт`, `Жильё`, `Подписки`, `Здоровье`, `Развлечения`, `Покупки`, `Другое`, `Кофешоп`, `Еда вне дома`, and `Спорт`.
- The income categories are `Фриланс` and `Работа`.
- Fuel and bike-rental payments use the category `Транспорт`; `Бензин` and `Аренда байка` are purposes kept in the normalized description or comment, not separate categories.
- AI must prefer an existing category. If none fits, it may suggest one normalized new category.
- A new category is added to the Notion `Категория` select only after the user confirms it in Telegram; never create categories silently.
- Category matching is case-insensitive and must reject aliases or near-duplicates of an existing category.
- When updating Notion select options, preserve every existing option and append the confirmed new option because omitted options may be removed by the API.
- Save the normalized description to Notion. Store raw Telegram text only if the user explicitly enables it for audit.
- AI parsing must return structured data and must never write directly to Notion.
- A parsed transaction requires user confirmation before it is saved.
- Currency conversion and report totals are calculated by application code, not by the language model.
- The opening balance is a controlled EUR setting with an effective date; it is not recorded as a fake income transaction.
- Every confirmed transaction stores `Остаток EUR`, the running balance immediately after that operation.
- For the total balance, income adds the converted EUR amount, expense subtracts it, and transfers between personal accounts do not change it.
- Backdated inserts, corrections, and deletions require recalculation of every later running balance in deterministic date/order sequence.
- Currency conversion uses Frankfurter v2 without an API key and targets EUR. EUR-to-EUR uses rate `1` without a network request.
- Request the rate for the transaction date. Accept the API's same-day rate or the latest returned prior rate, but never a rate after the transaction date.
- Send only the current transaction text and controlled category/account lists to the language model, not the complete budget history.
- Timezone defaults to `Asia/Ho_Chi_Minh` unless explicitly changed.
- The MVP uses the transaction date to request the historical rate and stores the applied rate; it does not expose a separate rate-date property in Notion.
- The MVP does not store a `Source` property because Telegram is the only input source.
- The MVP relies on Notion's built-in page creation metadata instead of a visible `Created` property.
- The current account list is `Наличные`, `Карта`, and `Сбережения`.
- The current currency list is `USD`, `RUB`, `VND`, `AUD`, and `EUR`.

## Telegram Rules

- Only allow configured Telegram user IDs.
- Bot replies must be short and action-oriented.
- Parsing failures should ask for a corrected message instead of silently guessing.
- Destructive actions must require explicit confirmation.

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
- A daily voice note may create multiple drafts, but every draft requires independent validation and confirmation.
- Optimize cost by shortening repeated prompts, using structured outputs, and measuring actual usage; do not sacrifice transaction correctness merely to reduce token count.

## Open Decisions

- Whether transfers between personal accounts are included in the MVP.
- Whether raw Telegram input is retained for audit or discarded after confirmation.
- The 10 representative Telegram messages used to verify AI parsing.
- Remaining Notion views and the first idempotent repository write.
- OpenAI API billing/key setup and live parser verification.
- Opening EUR balance, its effective date, and whether balances are total-only or separated by account.
- Multi-user database provider, owner-Notion versus unified-storage strategy, invitation policy, and OpenAI cost policy.

## Session Handoff — 2026-07-18

- GitHub and Vercel are connected, and the latest production deployment was previously verified as `Ready`.
- Telegram and Notion credentials are configured locally and as encrypted Vercel Production/Development variables. Preview variables are not configured yet.
- Notion `Категория` contains `Фриланс`, `Работа`, and `Спорт`; `Транспорт` remains the category for both fuel and bike rental.
- The text parser maps employment income to `Работа`, freelance income to `Фриланс`, gym/fitness/pickleball to `Спорт`, and fuel/bike rental to `Транспорт` while retaining the specific purpose in the comment.
- Frankfurter v2 conversion to EUR is implemented and tested for EUR, VND, USD, and a prior-date fallback. It needs no API key.
- OpenAI text parsing is implemented but cannot be tested live until `OPENAI_API_KEY` is added locally and in Vercel. A ChatGPT subscription is not an API credential.
- Continue strictly from `Current Next Actions` in `docs/checklist.md`.
- Multi-user storage and isolation planning is captured in Phase 10; implementation remains after the personal Telegram MVP.
