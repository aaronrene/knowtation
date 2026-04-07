---
title: Welcome — engineering team vault
project: engineering-team-template
tags:
  - onboarding
  - engineering
  - knowtation
date: 2026-04-07
---

# Welcome — engineering team vault

This vault complements your **code host and ticket system**: it holds narrative context that tickets rarely capture well—tradeoffs, blast radius, and how we actually run production.

## First steps

1. Get repo access, **laptop encryption**, and SSO groups confirmed by IT.
2. Read `onboarding/new-engineer.md` and check off items in your first PR or shared checklist.
3. Skim the latest **ADR** in `architecture/` for the service you will touch first.

## When to add a note

- **Before** merging a significant API or schema change → ADR in `architecture/`.
- **During** an incident → start from `incidents/` template; timestamp everything.
- **After** each retro → file under `retrospectives/` with owners and dates on action items.

## Conventions

- Link to **runbooks** from alerts and dashboards where possible; duplicate short “what to do” snippets in the alert body, full detail here.
- Prefer tags like `api`, `payments`, `pci`, `sre` for cross-team search.

## Security

Do not paste **production secrets**, customer PII, or unredacted stack traces with tokens. Reference secret manager names and ticket IDs instead.
