---
title: "ADR 001: Public API design — versioning and error model"
project: engineering-team-template
tags:
  - adr
  - api
  - design
date: 2026-04-07
---

# ADR 001: Public API design — versioning and error model

## Status

Accepted (template example)

## Context

We are exposing a **customer-facing HTTP API** for integrations. Mobile and server clients need predictable breaking-change policy, structured errors for programmatic handling, and observability-friendly request identifiers.

## Constraints

- Must support **monthly** releases; some customers upgrade slowly.
- Error payloads must avoid **PII** and internal stack traces.
- Rate limits and idempotency headers required for payment-adjacent endpoints.

## Alternatives considered

1. **URL path versioning only** (`/v1/...`) — simple; some clients cache aggressively and miss headers.
2. **Header-based negotiation only** — flexible; poor ergonomics for curl and beginner integrators.
3. **Combined path major + header minor** — more complex operations story.

## Decision

Use **`/v1` path prefix** for major breaking versions. Include **`X-Request-Id`** on all responses (echoed if provided). Errors use a stable JSON envelope: `code`, `message`, `details` (optional, non-sensitive), `request_id`.

## Outcome & consequences

Clients pin **major** in the URL; we add fields in minors. Support traces **request_id** without leaking internals. Tradeoff: we must honor **deprecation windows** and ship real changelogs. Link OpenAPI from the repo; see `runbooks/deploy-production.md` for capacity under **503** load.
