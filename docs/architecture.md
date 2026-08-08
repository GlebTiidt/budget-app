# Architecture Notes

## Boundaries

- `app`: process entrypoint and composition root.
- `budget`: core domain types and rules.
- `integrations`: external APIs such as Telegram, Notion, OpenAI, and Frankfurter.
- `storage`: user-scoped persistence adapters. The first adapter stores profiles and settings in one SQLite file on a dedicated server's persistent volume.
- `reports`: deterministic aggregation plus the master-account report model. The Notion reader is an integration; Chart.js only renders the already aggregated response.
- `config`: environment-backed settings.
- `clients`: Telegram is the MVP client; a future SwiftUI app calls the same server-side application boundary.

## Dependency Direction

`app` may depend on every module. Integrations may depend on `budget` and `config`. The budget domain should not depend on integrations.

## First Milestone

Implement one complete path:

```text
Telegram text -> OpenAI structured drafts -> independent confirmation -> validation -> currency conversion -> Notion rows -> Telegram confirmation
```

A single Telegram message may yield multiple ordered transaction drafts, separate debt-operation drafts, and balance observations. The Telegram client presents ordinary transactions in stable groups—income, expense, then personal transfer—while preserving their relative order inside each group. Ordinary operations and debt operations each start numbering from `1` in their separate preview sections; a correction uses a plain number for an ordinary operation and `долг N` for a debt item. Named wallet balances appear as unnumbered bullets, and their converted sum appears once as `Общий остаток` in the final summary paragraph. The user manages the preview by replying with ordinary text; a correction request sends only that normalized preview and direct reply back through the structured parser. Every operation is still reviewed independently, debt is never ordinary income or expense, and a balance observation is never treated as a transaction.

Dynamic OpenAI input context is serialized with the official TOON encoder: current text or normalized preview, the direct correction reply, controlled catalogs, timestamp, and timezone. OpenAI still returns strict JSON Schema Structured Outputs, which application code validates before Telegram sees them. Personal transfers use `account` as the source and `destinationAccount` as the receiver; they do not change the user's total balance.

The first confirmed balance-only message initializes the opening anchor from one
total observation or the converted sum of several named wallet observations on
one date. Each wallet observation remains separately auditable, while the app
maintains one calculated total rather than per-account running ledgers. A later
entry whose date is earlier than that anchor is still stored for historical
analytics but is outside the running-balance timeline: it does not move the
anchor and its running-balance property is left empty. Entries dated on or after
the anchor participate in deterministic date/order balance calculations.

The OpenAI boundary keeps static developer instructions before changing TOON data, uses separate stable cache keys for parsing and revision, and records only aggregate token usage. GPT-5.6 requests use `reasoning.effort: none`, low text verbosity, and an output cap after the representative live suite showed no quality regression versus `low`. Explicit cache breakpoints prevent changing user data from becoming a paid cache write; the current reusable prefix is intentionally not padded to reach the 1,024-token cache threshold.

The application aggregates totals itself, and the self-hosted Chart.js client renders the existing interactive owner report. The language model is never used for arithmetic. Every user chooses one base currency through text search in the bot. Original transaction amounts, currencies, and dates remain source facts, while preview totals and future reports are deterministically converted into that user's selected currency. Debt is the exception: positions are keyed by counterparty and original currency and are never converted merely for display or aggregation.

During the current product gate, new interaction work stays in Telegram. The existing report Mini App remains a read-only owner preview, but currency search and debt testing do not require a new internal application interface.

Frankfurter v2 provides the historical rate without a project API key. The converter sends the transaction date, converts into the requested user currency in application code, uses rate `1` for same-currency conversions, and rejects a returned rate dated after the transaction.

## User Settings Storage

```text
Telegram user ID -> UserSettingsRepository router
                     |                  |
             explicit master       every other user
                     |                  |
        private Notion settings     user_settings row in SQLite
```

Telegram depends on the `UserSettingsRepository` interface, not on either adapter. The explicit master ID is the only profile allowed into the owner's Notion settings data source so the personal Vercel surface can retain its preference. The SQLite adapter uses one database file and a unique `telegram_user_id` primary key for every other user. `USER_DATABASE_PATH` points to a persistent server volume. Per-user files are intentionally avoided because they make atomic updates, indexing, backups, and migrations harder.

This topology is for one dedicated application instance. Before horizontal scaling or multiple writers, move the repository adapter to a network database while keeping the domain and Telegram interfaces unchanged. Operational requirements are documented in [`server-storage.md`](server-storage.md).

## Master Account Reports

```text
Telegram /reports -> signed Mini App initData -> owner allowlist
                                               |
                                               v
                     Notion master ledger -> deterministic monthly aggregate
                                               |
                                               v
                              Chart.js bar / line / doughnut animation
```

Notion remains exclusive to the master account. The `/api/reports` boundary validates Telegram's HMAC-signed Mini App data, rejects stale authorization, requires the signed user to match the explicit master ID, and also checks the configured allowlist before it queries the Notion data source. It returns only monthly aggregates and category totals with `Cache-Control: no-store`; browser code never receives a Notion credential.

The report reads the owner's generic base-currency amount field and labels totals with the currency stored in the owner's settings. Chart.js 4.5.1 is pinned and self-hosted from `public/vendor`, so there is no per-user chart-service charge and no third-party chart script receives the report payload. The build is copied from the pinned `chart.js` package and its MIT license is retained beside the browser asset. Future user reports must read their isolated application storage rather than the master's Notion database.

The owner's ledger remains one `Транзакции` data source across every month. Its `Месяц` formula returns `Текущий месяц` for rows whose `Дата` falls in the current month and `YYYY-MM` for older rows. Dynamic current-month views filter on that formula; calendar views provide month navigation for all operations, income, and expenses. Fixed July 2026 views remain as the first explicit archive. Monthly separation never creates another transaction data source, so report queries, backdated corrections, and future running-balance recalculation keep one chronological source of truth.

## Future Client and Voice Path

```text
iOS microphone -> Apple on-device transcription (preferred) -> text
                                                        |
                                                        v
                                      server-side structured parser
                                                        |
Telegram text ------------------------------------------+
                                                        |
                                                        v
                              confirmation -> conversion -> Notion
```

If on-device recognition is unavailable or insufficient, the iOS client uploads only the captured clip to a server-side transcription endpoint. API keys remain on the server. A daily note is parsed into multiple drafts, but each draft follows the same confirmation and validation path as an immediate transaction.
