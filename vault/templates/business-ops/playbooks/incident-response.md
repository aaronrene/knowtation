---
title: Production incident response — SOP
project: business-ops-template
tags:
  - playbook
  - incident
  - sre
  - on-call
date: 2026-04-07
---

# Production incident response — SOP

**Applies to:** Customer-facing production services | **Owner:** Platform lead

## Severity guide (use one)

- **SEV1:** Full outage or data loss risk; wake secondary on-call.
- **SEV2:** Major degradation; work business hours unless revenue-critical.
- **SEV3:** Minor issue with workaround; ticket and batch fix.

## Immediate steps (first 15 minutes)

1. **Declare incident** in the status tool; set severity; post customer-facing banner only if user-visible.
2. Assign **Incident Commander (IC)** and **scribe**; IC drives, scribe timestamps actions.
3. Capture **symptoms**: error rates, regions, last deploy, dependency status—link dashboards in the incident doc.

## Stabilize before root cause

- Prefer **rollback** or feature flag off if change correlated; avoid speculative hotfixes during SEV1.

## Communication

- Internal updates every **30 minutes** for SEV1 until resolved.
- Customer comms go through **support lead**; no individual engineer posts externally.

## After resolution & escalation

Post **summary** (window, cause, remediation, follow-ups in 48h); book a **blameless retro** within five business days with owned actions. If IC is absent, secondary runs IC; loop legal/comms on **data exposure** suspicion. Replace tool names and contacts for your org.
