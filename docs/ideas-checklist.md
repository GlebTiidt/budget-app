# Product Ideas Checklist

This file captures future product ideas and UX details. It is not the delivery-status source of truth; implementation status remains in [`docs/checklist.md`](checklist.md).

## Personal Categories for New Users

- [ ] Let every new user choose their initial categories during onboarding instead of inheriting the owner's private list unchanged.
- [ ] Offer a small recommended starter set that the user may keep, remove, or extend.
- [ ] Use `Животные` instead of `Кот` in the recommended default category set; keep a specific animal or pet name in the normalized description or comment.
- [ ] Keep every user's categories isolated; one user's changes must never affect another user or the owner's Notion options.
- [ ] Allow users to create, rename, archive, and merge only their own categories.

## Create a Category from Telegram

- [ ] Support an explicit message such as `Создай категорию Путешествия`.
- [ ] When a transaction does not match an existing category, propose a normalized category name rather than silently creating it.
- [ ] Offer `Создать категорию`, `Использовать Другое`, and `Отмена` actions.
- [ ] Require confirmation before creating a category or saving the transaction under it.
- [ ] Reject case-insensitive duplicates, aliases, and near-duplicates of an existing category.
- [ ] Preserve all existing category options when appending a confirmed category to Notion.

## Friendly Category Hygiene at 15 Categories

- [ ] Count active categories separately for each user.
- [ ] When a user reaches 15 active categories, show a friendly, non-blocking suggestion instead of enforcing a hard limit.
- [ ] Suggested copy: `У тебя уже 15 категорий. Чем их больше, тем легче запутаться в отчётах. Хочешь посмотреть, что можно аккуратно объединить?`
- [ ] Offer `Посмотреть похожие`, `Оставить как есть`, and `Напомнить позже` actions.
- [ ] Never block the current transaction or prevent the user from keeping more than 15 categories.
- [ ] Suggest merge candidates using category meaning and actual usage, but never merge automatically.
- [ ] Before merging, show the source category, destination category, and number of affected transactions.
- [ ] Require explicit confirmation for every merge.
- [ ] Reassign historical transactions safely, archive the source category, and keep an audit record sufficient to undo an accidental merge.
- [ ] Ensure a merge can affect only the requesting user's data.

## Show Telegram Help Only When It Is Useful

- [x] Explain confirmation, corrections, cancellation, and `тоже` once during `/start` onboarding instead of repeating the full instruction block under every preview; show an observed balance only once in the summary without a `Б1` row.
- [x] Keep the same detailed guidance available through `/help` whenever the user wants to see it again.
- [x] In routine previews, show only a short conversational next step such as `Всё совпало? Напишите «всё верно».` without the repeated list of correction examples.
- [x] After an unrecognized correction, show only the hint relevant to that error rather than replaying the complete onboarding instructions.
- [x] Keep the mandatory preview-mode warning that nothing was written to Notion separate from optional usage hints; remove or revise that warning only when the confirmed save flow is enabled.
- [x] Store whether onboarding guidance has been shown in persistent, user-scoped state so deployments and server restarts do not make the bot teach the same person again.
- [x] Test that a new user receives the guidance, a returning user does not receive it on every transaction, and `/help` always restores it on demand.

## Telegram Idea Inbox

- [ ] Add an owner-only `/idea <текст>` command for capturing a new product idea directly from Telegram.
- [ ] Ask for confirmation before publishing the idea and warn the user not to include credentials or private financial data.
- [ ] Store the incoming idea as a GitHub Issue labeled `idea` instead of writing directly to the Vercel filesystem or committing to the default branch.
- [ ] Add `/ideas` to list open ideas with short identifiers and statuses in Telegram.
- [ ] Add `/idea_view <id>` to show one idea and `/idea_done <id>` to close it after explicit confirmation.
- [ ] Detect likely duplicate ideas and offer to append context to the existing idea or create a separate one.
- [ ] Add a controlled promotion step that syncs an accepted idea into this checklist through a reviewed change or pull request.
- [ ] Use a fine-grained, repository-scoped GitHub credential with only the minimum Issue permissions required; keep it in the active server's secret manager.
- [ ] Never let Telegram text choose repository paths, branches, commands, labels outside the allowlist, or raw GitHub API parameters.
- [ ] Keep repository-writing idea commands owner-only. Future users may submit private, user-scoped suggestions for moderation but must not receive repository access.
- [ ] Escape and length-limit idea text before sending it to GitHub, and keep an audit trail of the Telegram user and resulting Issue ID without logging sensitive message contents.

## Data Retention and Archiving

- [ ] Define a user-visible retention policy for transactions, balance observations, reports, and generated table data; start evaluation with a 2–3 year default and an optional extension up to 5 years.
- [ ] Let the user see and choose the retention period before any automatic archive or deletion is enabled.
- [ ] Decide separately what is archived, permanently deleted, or retained as compact monthly aggregates; never silently delete financial data.
- [ ] Provide export and a clear warning before the first irreversible deletion, with enough time for the user to keep a copy.
- [ ] Document backup retention and make sure deleted data also expires from backups on a predictable schedule.
- [ ] Measure database size, backup cost, report latency, and the actual usefulness of older records before choosing the default period.
- [ ] Measure token cost only for features that intentionally load historical records into an AI request. Ordinary parsing must continue sending only the current message and controlled catalogs, so keeping older database rows does not by itself consume more OpenAI tokens.
- [ ] Compare the value and cost of keeping 2, 3, and 5 years of detailed history before promoting a retention period into a stable product rule.

## Paid Visualization Services

- [ ] Keep the current animated Chart.js income/expense report in the core product; Chart.js is MIT-licensed and does not charge per user.
- [ ] If a future hosted chart, analytics, export, or embedded-dashboard provider charges per user, view, or request, put only those incremental provider-backed features into a paid tier.
- [ ] Show the expected provider cost and the added benefit before adopting a paid visualization dependency.
- [ ] Preserve a useful self-hosted report for free users even if a richer paid visualization tier is introduced.
- [ ] Measure chart-provider cost separately from OpenAI token cost because deterministic charts do not need language-model requests.

## Later UX Decisions

- [ ] Decide how long `Напомнить позже` suppresses the suggestion.
- [ ] Decide whether archived categories count toward the threshold; the recommended rule is to count active categories only.
- [ ] Decide whether category suggestions appear during onboarding, in settings, or in a periodic Telegram review.
- [ ] Decide whether accepted Telegram ideas are promoted to this file automatically through a pull request or manually during backlog review.
