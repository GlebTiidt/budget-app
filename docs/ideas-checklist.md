# Product Ideas Checklist

This file captures future product ideas and UX details. It is not the delivery-status source of truth; implementation status remains in [`docs/checklist.md`](checklist.md).

## Personal Categories for New Users

- [ ] Let every new user choose their initial categories during onboarding instead of inheriting the owner's private list unchanged.
- [ ] Offer a small recommended starter set that the user may keep, remove, or extend.
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

## Telegram Idea Inbox

- [ ] Add an owner-only `/idea <текст>` command for capturing a new product idea directly from Telegram.
- [ ] Ask for confirmation before publishing the idea and warn the user not to include credentials or private financial data.
- [ ] Store the incoming idea as a GitHub Issue labeled `idea` instead of writing directly to the Vercel filesystem or committing to the default branch.
- [ ] Add `/ideas` to list open ideas with short identifiers and statuses in Telegram.
- [ ] Add `/idea_view <id>` to show one idea and `/idea_done <id>` to close it after explicit confirmation.
- [ ] Detect likely duplicate ideas and offer to append context to the existing idea or create a separate one.
- [ ] Add a controlled promotion step that syncs an accepted idea into this checklist through a reviewed change or pull request.
- [ ] Use a fine-grained, repository-scoped GitHub credential with only the minimum Issue permissions required; keep it in Vercel environment variables.
- [ ] Never let Telegram text choose repository paths, branches, commands, labels outside the allowlist, or raw GitHub API parameters.
- [ ] Keep repository-writing idea commands owner-only. Future users may submit private, user-scoped suggestions for moderation but must not receive repository access.
- [ ] Escape and length-limit idea text before sending it to GitHub, and keep an audit trail of the Telegram user and resulting Issue ID without logging sensitive message contents.

## Later UX Decisions

- [ ] Decide how long `Напомнить позже` suppresses the suggestion.
- [ ] Decide whether archived categories count toward the threshold; the recommended rule is to count active categories only.
- [ ] Decide whether category suggestions appear during onboarding, in settings, or in a periodic Telegram review.
- [ ] Decide whether accepted Telegram ideas are promoted to this file automatically through a pull request or manually during backlog review.
