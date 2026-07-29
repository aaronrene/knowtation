# Hub UI Handover — Knowtation (signed-in dashboard)

**Lane:** Hub UI redesign only.  
**Pair with:** [`HUB-UI-ROADMAP.md`](./HUB-UI-ROADMAP.md).  
**Do not use** this file for Scooling product order or SEC work — that lives in [`OVERSEER-HANDOVER.md`](./OVERSEER-HANDOVER.md).

---

## NEXT SESSION — HUB-DASH-IA-merge (Tier 3 — wait for operator)

**Date:** 2026-07-29  
**Model:** **Operator + Auto**  
**Branch:** `feat/hub-dashboard-ia`

### Where is the frozen spec?

**Path (repo root relative):**

`docs/reviews/2026-07-29-hub-dashboard-ia.md`

`frozen: true` · `review_stamp.verdict: pass` (freeze-review-loop round 3). Build verification for b+c+d: **pass** (2026-07-29). Operator polish after BV: **HUB-DASH-IA-polish DONE**.

### THE ONE NEXT STEP — **Model: Operator + Auto**

```text
HUB-DASH-IA-merge — Tier 3 merge authorization only

Model: Operator + Auto.
Branch: feat/hub-dashboard-ia.
Read ONLY this lane: docs/HUB-UI-HANDOVER.md + docs/HUB-UI-ROADMAP.md.
Ground truth: docs/reviews/2026-07-29-hub-dashboard-ia.md (frozen: true, review_stamp.verdict: pass).
Shell IA (b+c+d) + operator polish shipped — do NOT redesign the signed-in shell.
Optional follow-on HUB-HELP-UX (How to use / Integrations for school audiences) is NOT required for merge.
Operator must explicitly authorize Muse/main merge (and muse-mirror → GitHub main per SD-14).
Until then: no merge; feature branch may stay open for PR review only if operator asks.
Do NOT edit product docs/OVERSEER-HANDOVER.md NEXT for Scooling.
Hard stops: no main merge without Tier 3; no secrets; no proposal RBAC changes.
```

### Operator decisions (frozen)

| Item | Choice |
| --- | --- |
| Queue name | **Review** |
| Discarded | Under **History** |
| Urgency | **Needs you** banner → Review |
| Branch | `feat/hub-dashboard-ia` from `main` |
| Freeze | **pass** 2026-07-29 |
| Build verification (b+c+d) | **pass** 2026-07-29 |
| Post-BV polish | **DONE** 2026-07-29 |

### Verified snapshot

| Item | Value |
| --- | --- |
| Lane docs | `docs/HUB-UI-ROADMAP.md`, `docs/HUB-UI-HANDOVER.md` |
| Freeze | `docs/reviews/2026-07-29-hub-dashboard-ia.md` — `review_stamp.verdict: pass` |
| HUB-DASH-IA-b/c/d | Shell + inbox + mobile shipped; BV **pass** |
| HUB-DASH-IA-polish | Rail vault switcher (“Active vault”); sticky header above detail; notes `50vw`; Quick tags; condensed search row; clustered rail; no onboarding auto-popup; Knowtation + gray **HUB** |
| Optional next (not merge-blocking) | **HUB-HELP-UX** — How to use / Integrations school-friendly copy & layout (Thinking → Auto if authorized) |
| Product board (ignore for UI sessions) | `docs/OVERSEER-HANDOVER.md` / `docs/ROADMAP.md` |
| Kit config primary docs | `.overseer/config.yaml` → product handover/roadmap (**unchanged**) |

### Change log

| Date | Change |
| --- | --- |
| 2026-07-29 | Lane created so Hub UI does not ride the Scooling/product Overseer baton. Freeze path documented. |
| 2026-07-29 | **HUB-DASH-IA-a DONE** — freeze-review-loop → **pass**; stamp on freeze artifact. NEXT = **HUB-DASH-IA-b** (Auto). |
| 2026-07-29 | **HUB-DASH-IA-b DONE** — shell IA on `feat/hub-dashboard-ia`; seven-tier shell tests green; BV left for **d**. NEXT = **HUB-DASH-IA-c** (Auto). |
| 2026-07-29 | **HUB-DASH-IA-c DONE** — Review inbox + Vault progressive disclosure + Insights; seven-tier inbox tests green; BV left for **d**. NEXT = **HUB-DASH-IA-d** (Auto). |
| 2026-07-29 | **HUB-DASH-IA-d DONE** — mobile bottom nav + How-to/onboarding polish; seven-tier mobile + reaffirm b/c; `/build-verification-review` → **pass** (b+c+d). NEXT = **HUB-DASH-IA-merge** (Operator + Auto, Tier 3). |
| 2026-07-29 | **HUB-DASH-IA-polish DONE** — operator review fixes (vault switcher, header/detail, Quick tags, search row, rail cluster, wizard auto-off, brand). NEXT remains **HUB-DASH-IA-merge**. Optional **HUB-HELP-UX** logged for school How-to/Integrations. |
