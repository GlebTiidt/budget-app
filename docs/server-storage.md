# Dedicated Server Storage

The planned persistent runtime is one dedicated Node.js server with a mounted data volume. Vercel may continue serving the owner's preview, but it is not the source of truth for user profiles.

The master account is a deliberate exception: its currency and onboarding flags are stored in the owner's private Notion `Настройки мастера` data source. The repository router permits that adapter only for `MASTER_TELEGRAM_USER_ID`; all non-master profiles use the dedicated server database.

## Current SQLite Boundary

- `USER_DATABASE_PATH` points to one SQLite file on the persistent volume, for example `/srv/budget-app/data/budget-app.sqlite`.
- `user_settings.telegram_user_id` is the primary key. Each Telegram user owns one row containing one base currency and future profile preferences.
- Never create one JSON or SQLite file per user. A single database provides atomic writes, indexes, migrations, and consistent backups.
- Run one application instance against this SQLite file. SQLite is not the multi-host coordination layer.
- The server runtime must support `node:sqlite`; use Node.js 22.5 or newer and pin the tested Node release in deployment.

## Backups and Recovery

- Place the database on a persistent volume, never on a container's temporary filesystem.
- Back up the SQLite database at least daily with a SQLite-safe snapshot or backup operation; copying only the main file while WAL writes are active is not a valid backup procedure.
- Encrypt backup storage, restrict access to the application operator, and keep a documented restore command.
- Run a restore test before calling the storage production-ready.
- Retention and deletion are not active yet. The 2–3 year default and optional 5-year window remain an idea until export, warnings, backup expiry, and irreversible-deletion behavior are designed and tested.

## Migration Boundary

Move `UserSettingsRepository` to PostgreSQL or another network database before any of these conditions:

- more than one application instance writes concurrently;
- the server uses ephemeral or replaceable disks without a persistent volume;
- availability requirements need automated failover;
- user transactions move from the owner's Notion ledger into shared application storage.

The Telegram and budget modules must not change when the adapter is replaced.
