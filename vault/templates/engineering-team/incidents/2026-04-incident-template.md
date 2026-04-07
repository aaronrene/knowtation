---
title: "Incident template — copy for each production incident"
project: engineering-team-template
tags:
  - incident
  - template
  - sre
date: 2026-04-07
---

# Incident — [TITLE] (TEMPLATE)

**Severity:** SEV? | **Status:** investigating | **Incident commander:** [name]

## Summary

One or two sentences on **user-visible impact** and scope (regions, percent of traffic).

## Timeline (UTC)

- HH:MM — alert fired [link]
- HH:MM — mitigation started [action]
- HH:MM — restored / degraded mode

## Impact, cause, mitigation

**Impact:** cohort affected; duration; SLA/revenue (internal—link finance if needed). **Root cause:** technical finding after evidence vs process/capacity factors. **Mitigation:** rollback, scale, shed traffic, flags, etc.

## Follow-up & lessons

Track actions (alerting, patches, runbook edits) with **owner** and **due**. Capture what sped response vs what slowed detection. **Replace brackets**; one file per incident; link tickets and the postmortem.
