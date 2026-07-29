# Hub UI Handover — Knowtation (signed-in dashboard)

**Lane:** Hub UI redesign only.  
**Pair with:** [`HUB-UI-ROADMAP.md`](./HUB-UI-ROADMAP.md).  
**Do not use** this file for Scooling product order or SEC work — that lives in [`OVERSEER-HANDOVER.md`](./OVERSEER-HANDOVER.md).

---

## NEXT SESSION — HUB-DASH-IA-d (mobile bottom nav + full BV)

**Date:** 2026-07-29  
**Model:** **Auto**  
**Branch:** `feat/hub-dashboard-ia`

### Where is the frozen spec?

**Path (repo root relative):**

`docs/reviews/2026-07-29-hub-dashboard-ia.md`

`frozen: true` · `review_stamp.verdict: pass` (freeze-review-loop round 3). Build exactly to that artifact — no redesign.

### THE ONE NEXT STEP — **Model: Auto**

```text
HUB-DASH-IA-d — Mobile bottom nav + onboarding/How-to polish + full build verification

Model: Auto.
Branch: feat/hub-dashboard-ia.
Read ONLY this lane: docs/HUB-UI-HANDOVER.md + docs/HUB-UI-ROADMAP.md.
Ground truth: docs/reviews/2026-07-29-hub-dashboard-ia.md (frozen: true, review_stamp.verdict: pass).
Implement HUB-DASH-IA-d only: mobile bottom nav Vault | Review(N) | History | More (Import/Connect/Settings/Help); onboarding/How-to copy sync polish; seven-tier green for d + reaffirm b/c; run /build-verification-review → pass (covers b+c+d). Expert item 20.
Preserve critical IDs / data-tab values / RBAC per freeze.
Do NOT start HUB-DASH-IA-merge (Tier 3) without operator authorization.
Do NOT edit product docs/OVERSEER-HANDOVER.md NEXT for Scooling.
Hard stops: no main merge; no secrets; no proposal RBAC changes.
Exit: d-slice matches freeze; BV pass; update HUB-UI-ROADMAP + this handover together.
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
| HUB-DASH-IA-b | Shell shipped — left rail Vault/Review(N)/History; History Activity\|Discarded; Needs-you; Review rename; unfiltered badge + pulse; Connect→`openSettingsIntegrationsTab()`; Import/Help/Settings/Insights rail; Vault List\|Calendar only. Tests: `test/hub-dashboard-ia-shell.test.mjs`. |
| HUB-DASH-IA-c | Review inbox + Vault search + Insights shipped — Review toolbar hides note search; row density + ↑↓ Enter; split N-of-M + focus ring; primary actions/eval above diffs; pending-eval chip; search-first + advanced filters collapsed; Insights = graph + `#consolidation-card`; empty Review New proposal + How Review works. Tests: `test/hub-dashboard-ia-inbox.test.mjs` (7 tiers, green with shell). **BV deferred to HUB-DASH-IA-d** per roadmap phase ownership. |
| Product board (ignore for UI sessions) | `docs/OVERSEER-HANDOVER.md` / `docs/ROADMAP.md` |
| Kit config primary docs | `.overseer/config.yaml` → product handover/roadmap (**unchanged**) |

### Change log

| Date | Change |
| --- | --- |
| 2026-07-29 | Lane created so Hub UI does not ride the Scooling/product Overseer baton. Freeze path documented. |
| 2026-07-29 | **HUB-DASH-IA-a DONE** — freeze-review-loop → **pass**; stamp on freeze artifact. NEXT = **HUB-DASH-IA-b** (Auto). |
| 2026-07-29 | **HUB-DASH-IA-b DONE** — shell IA on `feat/hub-dashboard-ia`; seven-tier shell tests green; BV left for **d**. NEXT = **HUB-DASH-IA-c** (Auto). |
| 2026-07-29 | **HUB-DASH-IA-c DONE** — Review inbox + Vault progressive disclosure + Insights; seven-tier inbox tests green; BV left for **d**. NEXT = **HUB-DASH-IA-d** (Auto). |
