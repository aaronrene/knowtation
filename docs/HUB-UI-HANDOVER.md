# Hub UI Handover — Knowtation (signed-in dashboard)

**Lane:** Hub UI redesign only.  
**Pair with:** [`HUB-UI-ROADMAP.md`](./HUB-UI-ROADMAP.md).  
**Do not use** this file for Scooling product order or SEC work — that lives in [`OVERSEER-HANDOVER.md`](./OVERSEER-HANDOVER.md).

---

## NEXT SESSION — HUB-DASH-IA-merge (Tier 3 — Muse-capable machine)

**Date:** 2026-07-29  
**Model:** **Operator + Auto**  
**Branch:** `feat/hub-dashboard-ia` @ `f75f07c` (pushed to `origin`)

### Where is the frozen spec?

**Path (repo root relative):**

`docs/reviews/2026-07-29-hub-dashboard-ia.md`

`frozen: true` · `review_stamp.verdict: pass` (freeze-review-loop round 3). Build verification for b+c+d: **pass** (2026-07-29). Operator polish after BV: **HUB-DASH-IA-polish DONE**.

### Status on this machine (no Muse)

| Item | State |
| --- | --- |
| Build (a→d + polish) | **DONE** — nothing left to implement here for HUB-DASH-IA |
| Feature branch on GitHub | **Pushed** — `origin/feat/hub-dashboard-ia` = `f75f07c` |
| Muse / MuseHub locally | **Unavailable** (Hub protocol refactor; `.muse` missing) |
| Muse/`main` + muse-mirror | **Deferred** — run on a Muse-capable computer |
| Optional HUB-HELP-UX | **Not** merge-blocking; start only if operator green-lights |

This env may continue **other** lanes (product/Scooling via `OVERSEER-HANDOVER.md`). Hub UI build work is idle until merge lands or HUB-HELP-UX is authorized.

### THE ONE NEXT STEP — **Model: Operator + Auto** (Muse machine)

```text
HUB-DASH-IA-merge — Tier 3 Muse/main + muse-mirror (Muse-capable machine)

Model: Operator + Auto.
Branch: feat/hub-dashboard-ia (fetch latest from origin — HEAD should be f75f07c lane-doc deferral or newer).
Read ONLY: docs/HUB-UI-HANDOVER.md + docs/HUB-UI-ROADMAP.md.
Ground truth: docs/reviews/2026-07-29-hub-dashboard-ia.md (frozen: true, review_stamp.verdict: pass).
Shell IA (b+c+d) + HUB-DASH-IA-polish already shipped on the feature branch — do NOT redesign.

Operator authorized (2026-07-29): Muse/main merge + muse-mirror → GitHub main (SD-14).
This machine has Muse; the no-Muse env pushed the feature branch to origin and deferred land.

Do:
1. muse status; ensure .muse present; fetch/pull staging as needed
2. Land feat/hub-dashboard-ia onto Muse main (checkout main → merge feature → push staging main)
3. muse-mirror → GitHub main via PR, merge-commit only (never git push origin main)
4. Mark HUB-DASH-IA-merge DONE in docs/HUB-UI-ROADMAP.md + regenerate docs/HUB-UI-HANDOVER.md NEXT (optional HUB-HELP-UX or idle). Do NOT edit product OVERSEER-HANDOVER NEXT for Scooling.

Hard stops: no secrets; no proposal RBAC changes; no direct push to GitHub main.
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
| GitHub feature backup | **Pushed** 2026-07-29 (`f75f07c`; polish code @ `6919c7b`) |

### Verified snapshot

| Item | Value |
| --- | --- |
| Lane docs | `docs/HUB-UI-ROADMAP.md`, `docs/HUB-UI-HANDOVER.md` |
| Freeze | `docs/reviews/2026-07-29-hub-dashboard-ia.md` — `review_stamp.verdict: pass` |
| HUB-DASH-IA-b/c/d | Shell + inbox + mobile shipped; BV **pass** |
| HUB-DASH-IA-polish | Rail vault switcher (“Active vault”); sticky header above detail; notes `50vw`; Quick tags; condensed search row; clustered rail; no onboarding auto-popup; Knowtation + gray **HUB** |
| Git remote | `origin/feat/hub-dashboard-ia` @ `f75f07c` |
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
| 2026-07-29 | Operator authorized Muse/`main` + muse-mirror; this env has no Muse — **deferred**. Feature branch **pushed** to `origin` (`6919c7b`). NEXT = merge on Muse-capable machine; no further Hub UI build here. |
