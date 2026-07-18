# Development Rules

This is the living rules file for the budget app. We update it when decisions become stable.

## Delivery Workflow

- `docs/checklist.md` is the single source of truth for delivery status.
- Work in checklist order and update it in the same change that completes a milestone.
- Do not mark scaffolding, configuration placeholders, or unverified external integrations as complete.
- A required item may be skipped only when it is explicitly marked blocked with a reason.

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
- The current category list is `Кот`, `Еда`, `Транспорт`, `Жильё`, `Подписки`, `Здоровье`, `Развлечения`, `Покупки`, `Другое`, `Кофешоп`, and `Еда вне дома`.
- AI must prefer an existing category. If none fits, it may suggest one normalized new category.
- A new category is added to the Notion `Категория` select only after the user confirms it in Telegram; never create categories silently.
- Category matching is case-insensitive and must reject aliases or near-duplicates of an existing category.
- When updating Notion select options, preserve every existing option and append the confirmed new option because omitted options may be removed by the API.
- Save the normalized description to Notion. Store raw Telegram text only if the user explicitly enables it for audit.
- AI parsing must return structured data and must never write directly to Notion.
- A parsed transaction requires user confirmation before it is saved.
- Currency conversion and report totals are calculated by application code, not by the language model.
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

- Category taxonomy and account list supplied to the AI parser.
- Notion database properties and views.
- Currency handling and exchange-rate policy.
- Raw Telegram text retention policy.
