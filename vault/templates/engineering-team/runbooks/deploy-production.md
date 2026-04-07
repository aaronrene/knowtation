---
title: Runbook — deploy to production
project: engineering-team-template
tags:
  - runbook
  - deploy
  - production
date: 2026-04-07
---

# Runbook — deploy to production

**Service:** api-core (template) | **Owner:** Platform rotation | **Last verified:** 2026-04-07

## Preconditions

- [ ] Change merged to `main` with **green CI** and required approvals.
- [ ] **Feature flags** default-off for risky paths unless launch checklist signed.
- [ ] Maintenance window communicated if **database migration** >30s lock risk.

## Steps

1. **Announce** deploy start in `#deploys` with commit SHA and ticket link.
2. Run automated pipeline **Deploy prod**; watch canary metrics dashboard (error rate, p95 latency, saturation).
3. Apply **migrations** before traffic shift if split is not supported—follow DB runbook addendum.
4. Shift **10% → 50% → 100%** canary if healthy; pause ≥5 minutes between stages.
5. Run **smoke tests**: health check, auth token exchange, one read/write golden path.

## Rollback

- If canary error rate **>2x baseline** for 3 minutes: **abort** and roll back to previous artifact.
- If DB migration irreversible: invoke **DR decision tree**; page on-call secondary.

## Post-deploy

Tag the release; post changelog to `#deploys`; confirm **SLO burn** normalizes within 30m; update the status page if users see the change. **On-call:** PagerDuty `api-core`; **DBA:** internal roster. Tune stage names and thresholds to your real telemetry.
