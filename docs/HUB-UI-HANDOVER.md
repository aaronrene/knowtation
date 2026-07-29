# Hub UI Handover — Knowtation (signed-in dashboard)

**Lane:** Hub UI redesign only.  
**Pair with:** [`HUB-UI-ROADMAP.md`](./HUB-UI-ROADMAP.md).  
**Do not use** this file for Scooling product order or SEC work — that lives in [`OVERSEER-HANDOVER.md`](./OVERSEER-HANDOVER.md).

---

## NEXT SESSION — HUB-DASH-IA-a (freeze review)

**Date:** 2026-07-29  
**Model:** **Thinking** (thinking-high)  
**Branch:** `feat/hub-dashboard-ia`

### Where is the frozen spec?

**Path (repo root relative):**

`docs/reviews/2026-07-29-hub-dashboard-ia.md`

Open that file in the editor, or:

```bash
open docs/reviews/2026-07-29-hub-dashboard-ia.md
# or
less docs/reviews/2026-07-29-hub-dashboard-ia.md
```

It declares `frozen: true` and holds operator decisions (Review, History/Discarded, Needs-you) plus expert UX defaults. **Freeze review verdict is still pending** — do not start Auto build until `/freeze-review-loop` (or Check OK) returns **pass**.

### THE ONE NEXT STEP — **Model: Thinking**

```text
HUB-DASH-IA-a — freeze review for signed-in Hub IA

Model: Thinking (thinking-high).
Branch: feat/hub-dashboard-ia.
Read ONLY this lane: docs/HUB-UI-HANDOVER.md + docs/HUB-UI-ROADMAP.md.
Ground truth: docs/reviews/2026-07-29-hub-dashboard-ia.md (frozen: true).
Run /freeze-review-loop (or Check OK) against that artifact.
Do NOT edit product docs/OVERSEER-HANDOVER.md NEXT for Scooling.
Do NOT start Auto shell implementation until verdict is pass.
Hard stops: no main merge; no secrets; no proposal RBAC changes in this step.
Exit: review_stamp / verdict pass on the freeze artifact; update HUB-UI-ROADMAP + this handover together.
```

### Operator decisions (already in freeze)

| Item | Choice |
| --- | --- |
| Queue name | **Review** |
| Discarded | Under **History** |
| Urgency | **Needs you** banner → Review |
| Branch | `feat/hub-dashboard-ia` from `main` |

### Verified snapshot

| Item | Value |
| --- | --- |
| Lane docs | `docs/HUB-UI-ROADMAP.md`, `docs/HUB-UI-HANDOVER.md` |
| Freeze | `docs/reviews/2026-07-29-hub-dashboard-ia.md` |
| Product board (ignore for UI sessions) | `docs/OVERSEER-HANDOVER.md` / `docs/ROADMAP.md` |
| Kit config primary docs | `.overseer/config.yaml` → product handover/roadmap (**unchanged**) |

### Change log

| Date | Change |
| --- | --- |
| 2026-07-29 | Lane created so Hub UI does not ride the Scooling/product Overseer baton. Freeze path documented. |
