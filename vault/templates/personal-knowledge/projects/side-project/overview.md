---
title: "Side project overview — local-first habit tracker"
project: "habit-tracker-app"
tags:
  - project
  - roadmap
  - side-project
date: 2026-04-07
---

# Habit tracker (local-first)

**Goal** — Ship a minimal CLI + optional web UI that stores data in plain Markdown/JSON under the user’s control. No accounts, no cloud requirement.

**Why** — Personal itch: existing apps either sync to servers I don’t trust or are too heavy for a single user.

## Timeline (12 weeks)

| Phase | Weeks | Outcome |
| ----- | ----- | ------- |
| Core model | 1–3 | Data schema, import/export |
| CLI | 4–6 | Log habits, streaks, reports |
| Polish | 7–9 | Themes, reminders (local) |
| Release | 10–12 | Docs, installer, v0.1 tag |

## Milestones

1. **M1** — `habit log` writes append-only entries with timestamps.
2. **M2** — Weekly summary command with CSV export.
3. **M3** — README + license + signed macOS build (if feasible).

**Risks** — Scope creep on UI; mitigate by shipping CLI first.
