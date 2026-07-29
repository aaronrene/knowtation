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

`frozen: true` · `review_stamp.verdict: pass` (freeze-review-loop round 3). Build verification for b+c+d: **pass** (2026-07-29).

### THE ONE NEXT STEP — **Model: Operator + Auto**

```text
HUB-DASH-IA-merge — Tier 3 merge authorization only

Model: Operator + Auto.
Branch: feat/hub-dashboard-ia.
Read ONLY this lane: docs/HUB-UI-HANDOVER.md + docs/HUB-UI-ROADMAP.md.
Ground truth: docs/reviews/2026-07-29-hub-dashboard-ia.md (frozen: true, review_stamp.verdict: pass).
Build verification for HUB-DASH-IA-b+c+d already pass — do NOT redesign.
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

### Verified snapshot

| Item | Value |
| --- | --- |
| Lane docs | `docs/HUB-UI-ROADMAP.md`, `docs/HUB-UI-HANDOVER.md` |
| Freeze | `docs/reviews/2026-07-29-hub-dashboard-ia.md` — `review_stamp.verdict: pass` |
| HUB-DASH-IA-b | Shell shipped — left rail Vault/Review(N)/History; History Activity\|Discarded; Needs-you; Review rename; unfiltered badge + pulse; Connect→`openSettingsIntegrationsTab()`; Import/Help/Settings/Insights rail; Vault List\|Calendar only. Tests: `test/hub-dashboard-ia-shell.test.mjs`. |
| HUB-DASH-IA-c | Review inbox + Vault search + Insights shipped — Review toolbar hides note search; row density + ↑↓ Enter; split N-of-M + focus ring; primary actions/eval above diffs; pending-eval chip; search-first + advanced filters collapsed; Insights = graph + `#consolidation-card`; empty Review New proposal + How Review works. Tests: `test/hub-dashboard-ia-inbox.test.mjs`. |
| HUB-DASH-IA-d | Mobile bottom nav Vault\|Review(N)\|History\|More (Import/Connect/Settings/Help; Insights in More on mobile); onboarding/How-to copy sync; BV **pass** covering b+c+d. Tests: `test/hub-dashboard-ia-mobile.test.mjs` (36/36 green with shell+inbox). |
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
