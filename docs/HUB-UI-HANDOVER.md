# Hub UI Handover — Knowtation (signed-in dashboard)

**Lane:** Hub UI redesign only.  
**Pair with:** [`HUB-UI-ROADMAP.md`](./HUB-UI-ROADMAP.md).  
**Do not use** this file for Scooling product order or SEC work — that lives in [`KNOWTATION-OVERSEER-HANDOVER.md`](./KNOWTATION-OVERSEER-HANDOVER.md).

---

## NEXT SESSION — lane idle (HUB-DASH-IA landed; optional HUB-HELP-UX)

**Date:** 2026-07-31  
**Model:** **Thinking → Auto** (only if operator green-lights HUB-HELP-UX)

**HUB-DASH-IA-merge is DONE (2026-07-31).** The GitHub-only feature branch
(`origin/feat/hub-dashboard-ia`, tip `55fe2c5`) was imported file-exact onto a Muse
feature branch on the Muse-capable machine, suites re-ran green locally (**58/58**:
shell + inbox + mobile + section-source + onboarding-wizard), and it landed via
Muse/`main` → muse-bridge-deploy → muse-mirror PR #286 (green CI). Muse remains
canonical; SD-14 honored throughout.

### Where is the frozen spec?

`docs/reviews/2026-07-29-hub-dashboard-ia.md` — `frozen: true` ·
`review_stamp.verdict: pass` (freeze-review-loop round 3). Build verification for
b+c+d: **pass** (2026-07-29). Operator polish after BV: **HUB-DASH-IA-polish DONE**.

### THE ONE NEXT STEP — idle unless HUB-HELP-UX is authorized

```text
HUB-HELP-UX (optional, NOT started) — school/Scooling-friendly How to use +
Integrations presentation (audience tabs, plain verbs, Hub API first).
Model: Thinking → Auto. Requires its own freeze artifact + freeze-review pass
before any Auto build. Do NOT start without operator green-light.
Product order (approval surfaces, vault picker) lives on the Scooling board —
see ~/scooling/docs/OVERSEER-HANDOVER.md (9-ux-a / 9-ux-b), which may supersede
this lane's optional work.
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
| Merge authorization | **Given** 2026-07-29 — land on Muse-capable machine |
| GitHub feature backup | **Pushed** 2026-07-29 (polish code @ `6919c7b` + handover deferral commits) |

### Verified snapshot

| Item | Value |
| --- | --- |
| Lane docs | `docs/HUB-UI-ROADMAP.md`, `docs/HUB-UI-HANDOVER.md` |
| Freeze | `docs/reviews/2026-07-29-hub-dashboard-ia.md` — `review_stamp.verdict: pass` |
| HUB-DASH-IA-b/c/d | Shell + inbox + mobile shipped; BV **pass** |
| HUB-DASH-IA-polish | Rail vault switcher (“Active vault”); sticky header above detail; notes `50vw`; Quick tags; condensed search row; clustered rail; no onboarding auto-popup; Knowtation + gray **HUB** |
| Git remote | `origin/feat/hub-dashboard-ia` — **landed** 2026-07-31 (Muse `main` → muse-mirror PR #286) |
| Optional next (not merge-blocking) | **HUB-HELP-UX** — How to use / Integrations school-friendly copy & layout (Thinking → Auto if authorized) |
| Product board (ignore for UI sessions) | `docs/KNOWTATION-OVERSEER-HANDOVER.md` / `docs/KNOWTATION-ROADMAP.md` |
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
| 2026-07-29 | Operator authorized Muse/`main` + muse-mirror; this env has no Muse — **deferred**. Feature branch **pushed** to `origin` (`6919c7b`). NEXT = merge on Muse-capable machine; no further Hub UI build here. |
| 2026-07-31 | **HUB-DASH-IA-merge DONE** — imported `origin/feat/hub-dashboard-ia` (`5230949..55fe2c5`) file-exact onto Muse feature branch on the Muse-capable machine; suites **58/58** local; landed Muse/`main` → muse-mirror PR #286 (green CI). Lane **idle**; optional HUB-HELP-UX awaits operator green-light. |
