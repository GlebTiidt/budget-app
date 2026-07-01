# Development Rules

This is the living rules file for the budget app. We update it when decisions become stable.

## Product Principles

- The app is personal-first: optimize for speed, low friction, and clear personal accounting.
- Telegram is the first interface for testing and daily input.
- Notion is the first accounting backend and should remain human-readable.
- Avoid overbuilding until a real workflow proves the need.

## Data Rules

- Every transaction must have amount, currency, direction, date, and source.
- Direction is either `expense`, `income`, or `transfer`.
- Categories should be normalized before saving to Notion.
- Raw user input should be preserved when practical, so parsing mistakes can be reviewed.
- Timezone defaults to `Asia/Ho_Chi_Minh` unless explicitly changed.

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

## Open Decisions

- Exact Telegram message format for transactions.
- Notion database properties and views.
- Currency handling and exchange-rate policy.
- Category taxonomy.
- Deployment target.
