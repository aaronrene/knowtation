# Hub UI Handover — Knowtation (signed-in dashboard)

**Lane:** Hub UI redesign only.  
**Pair with:** [`HUB-UI-ROADMAP.md`](./HUB-UI-ROADMAP.md).  
**Do not use** this file for Scooling product order or SEC work — that lives in [`OVERSEER-HANDOVER.md`](./OVERSEER-HANDOVER.md).

---

## NEXT SESSION — HUB-DASH-IA-b (shell Auto)

**Date:** 2026-07-29  
**Model:** **Auto**  
**Branch:** `feat/hub-dashboard-ia`

### Where is the frozen spec?

**Path (repo root relative):**

`docs/reviews/2026-07-29-hub-dashboard-ia.md`

`frozen: true` · `review_stamp.verdict: pass` (freeze-review-loop round 3). Build exactly to that artifact — no redesign.

### THE ONE NEXT STEP — **Model: Auto**

```text
HUB-DASH-IA-b — signed-in Hub shell to frozen IA

Model: Auto.
Branch: feat/hub-dashboard-ia.
Read ONLY this lane: docs/HUB-UI-HANDOVER.md + docs/HUB-UI-ROADMAP.md.
Ground truth: docs/reviews/2026-07-29-hub-dashboard-ia.md (frozen: true, review_stamp.verdict: pass).
Implement HUB-DASH-IA-b only: left rail (Vault / Review(N) / History), History segments Activity|Discarded, Needs-you banner, Review rename + unfiltered proposed badge, Connect→openSettingsIntegrationsTab(), Import/Help/Settings rail entries, rail accent + badge pulse (expert 1,7,9–12,14–16,18–19).
Preserve critical IDs / data-tab values / RBAC per freeze.
Seven-tier tests for shell contracts; do NOT mark DONE until /build-verification-review → pass (or leave BV for d if roadmap says so — still green tests this step).
Do NOT edit product docs/OVERSEER-HANDOVER.md NEXT for Scooling.
Do NOT start HUB-DASH-IA-c scope (Review toolbar / Insights / search progressive disclosure).
Hard stops: no main merge; no secrets; no proposal RBAC changes.
Exit: shell matches freeze b-slice; update HUB-UI-ROADMAP + this handover together.
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
| Product board (ignore for UI sessions) | `docs/OVERSEER-HANDOVER.md` / `docs/ROADMAP.md` |
| Kit config primary docs | `.overseer/config.yaml` → product handover/roadmap (**unchanged**) |

### Change log

| Date | Change |
| --- | --- |
| 2026-07-29 | Lane created so Hub UI does not ride the Scooling/product Overseer baton. Freeze path documented. |
| 2026-07-29 | **HUB-DASH-IA-a DONE** — freeze-review-loop → **pass**; stamp on freeze artifact. NEXT = **HUB-DASH-IA-b** (Auto). |
