---
title: "ADR 001: Core product technology stack"
project: business-ops-template
tags:
  - adr
  - engineering
  - stack
date: 2026-04-07
---

# ADR 001: Core product technology stack

## Status

Accepted (template example)

## Context

We are launching a **B2B workflow product** with a small engineering team (four engineers). We need a stack that supports rapid iteration, solid hiring pool, and managed infrastructure to limit ops toil.

## Options considered

1. **Node (TypeScript) + React + Postgres on managed cloud** — broad talent market; mature tooling.
2. **Ruby on Rails + Hotwire** — excellent for CRUD-heavy apps; smaller pool in our region for this template scenario.
3. **Go microservices + separate SPA** — strong performance; higher baseline complexity for a four-person team.

## Decision

Adopt **TypeScript end-to-end**: React frontend, Node API layer, **Postgres** as system of record, object storage for files, and **infrastructure as code** for environments. Background work uses a managed queue.

## Rationale

- Single language reduces context switching and eases **full-stack ownership**.
- Managed Postgres and queue offload patching and failover basics we cannot staff 24/7 yet.

## Consequences

Faster hiring and safer integrations; cost is **bundle churn**—enforce linting and scheduled upgrades. Revisit at Series A scale if SLO burn exceeds the engineering roadmap thresholds.
