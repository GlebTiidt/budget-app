# Repository Workflow

Before changing this project, read `docs/rules.md`, `docs/checklist.md`, and `docs/architecture.md`.

- Treat `docs/checklist.md` as the single source of truth for delivery status.
- Work in checklist order. Do not skip a required item unless it is marked blocked with a reason.
- Update the checklist in the same change that completes or changes a milestone.
- Never mark scaffolding or an unverified integration as complete.
- Run the verification commands named in the checklist before marking technical work complete.
- Never commit credentials. Use `.env.local` locally and Vercel environment variables in production.

