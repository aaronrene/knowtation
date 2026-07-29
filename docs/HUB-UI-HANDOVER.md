# Hub UI Handover — Knowtation (signed-in dashboard)

**Lane:** Hub UI redesign only.  
**Pair with:** [`HUB-UI-ROADMAP.md`](./HUB-UI-ROADMAP.md).  
**Do not use** this file for Scooling product order or SEC work — that lives in [`OVERSEER-HANDOVER.md`](./OVERSEER-HANDOVER.md).

---

## NEXT SESSION — HUB-DASH-IA-c (Review inbox + Vault search + Insights)

**Date:** 2026-07-29  
**Model:** **Auto**  
**Branch:** `feat/hub-dashboard-ia`

### Where is the frozen spec?

**Path (repo root relative):**

`docs/reviews/2026-07-29-hub-dashboard-ia.md`

`frozen: true` · `review_stamp.verdict: pass` (freeze-review-loop round 3). Build exactly to that artifact — no redesign.

### THE ONE NEXT STEP — **Model: Auto**

```text
HUB-DASH-IA-c — Review inbox + Vault search progressive disclosure + Insights

Model: Auto.
Branch: feat/hub-dashboard-ia.
Read ONLY this lane: docs/HUB-UI-HANDOVER.md + docs/HUB-UI-ROADMAP.md.
Ground truth: docs/reviews/2026-07-29-hub-dashboard-ia.md (frozen: true, review_stamp.verdict: pass).
Implement HUB-DASH-IA-c only: Review mode toolbar (hide note search; show proposal filters + New proposal); row density + keyboard; split-view polish; primary actions above diffs; pending-eval chip; Vault search-first command bar (advanced filters collapsed); Insights = Overview (data-view=graph) + #consolidation-card; empty Review CTA (expert 2–6, 8, 13, 17).
Preserve critical IDs / data-tab values / RBAC per freeze.
Seven-tier tests for c-slice contracts.
Do NOT start HUB-DASH-IA-d (mobile bottom nav / full BV) unless finishing c early and roadmap says so.
Do NOT edit product docs/OVERSEER-HANDOVER.md NEXT for Scooling.
Hard stops: no main merge; no secrets; no proposal RBAC changes.
Exit: c-slice matches freeze; update HUB-UI-ROADMAP + this handover together.
```

### Operator decisions (frozen)

| Item | Choice |
| --- | --- |
| Queue name | **Review** |
| Discarded | Under **History** |
| Urgency | **Needs you** banner → Review |
| Branch | `feat/hub-dashboard-ia` from `main` |
| Freeze | **pass** 2026-07-29 |

### Verified snapshot

| Item | Value |
| --- | --- |
| Lane docs | `docs/HUB-UI-ROADMAP.md`, `docs/HUB-UI-HANDOVER.md` |
| Freeze | `docs/reviews/2026-07-29-hub-dashboard-ia.md` — `review_stamp.verdict: pass` |
| HUB-DASH-IA-b | Shell shipped on branch — left rail Vault/Review(N)/History; History Activity\|Discarded; Needs-you; Review rename; unfiltered badge + pulse; Connect→`openSettingsIntegrationsTab()`; Import/Help/Settings/Insights rail; Vault List\|Calendar only. Tests: `test/hub-dashboard-ia-shell.test.mjs` (7 tiers, green). **BV deferred to HUB-DASH-IA-d** per roadmap phase ownership. |
| Product board (ignore for UI sessions) | `docs/OVERSEER-HANDOVER.md` / `docs/ROADMAP.md` |
| Kit config primary docs | `.overseer/config.yaml` → product handover/roadmap (**unchanged**) |

### Change log

| Date | Change |
| --- | --- |
| 2026-07-29 | Lane created so Hub UI does not ride the Scooling/product Overseer baton. Freeze path documented. |
| 2026-07-29 | **HUB-DASH-IA-a DONE** — freeze-review-loop → **pass**; stamp on freeze artifact. NEXT = **HUB-DASH-IA-b** (Auto). |
| 2026-07-29 | **HUB-DASH-IA-b DONE** — shell IA on `feat/hub-dashboard-ia`; seven-tier shell tests green; BV left for **d**. NEXT = **HUB-DASH-IA-c** (Auto). |
