# Hub UI Roadmap — Knowtation (signed-in dashboard)

**Lane:** Hub UI redesign only.  
**Not** the product/security board (`docs/ROADMAP.md` / Scooling).  
**Not** wired as `.overseer/config.yaml` → `docs.roadmap` (that stays the product roadmap).

Use this file + [`HUB-UI-HANDOVER.md`](./HUB-UI-HANDOVER.md) for any session that redesigns the **signed-in Hub**. Product NEXT stays on `docs/OVERSEER-HANDOVER.md`.

## Phase Model Key

| Label | Meaning |
| --- | --- |
| **Thinking** | Design + freeze; no mechanical build |
| **Auto** | Build exactly to frozen IA |
| **Thinking → Auto** | `{step}a` then `{step}b` only |
| **Operator + Auto** | Human for Tier-3 merge; Auto for impl |

## Freeze / ground truth

| Artifact | Role |
| --- | --- |
| [`docs/reviews/2026-07-29-hub-dashboard-ia.md`](./reviews/2026-07-29-hub-dashboard-ia.md) | **Frozen IA** (`frozen: true`) — operator decisions + expert defaults. Freeze review still **pending**. |

## Build queue

| Phase | Model | Status | Deliverable |
| --- | --- | --- | --- |
| **HUB-DASH-IA-a** | **Thinking** | **IN PROGRESS** — freeze written; review pending | Ratify IA: Vault / Review(N) / History; Discarded under History; Needs-you banner; retire user-facing “Suggested”. Artifact: `docs/reviews/2026-07-29-hub-dashboard-ia.md`. Exit: `/freeze-review-loop` → **pass**. |
| **HUB-DASH-IA-b** | **Auto** | **TODO** (blocked on a = pass) | Shell: left rail, History segments, Needs-you, Review rename, badge. Branch: `feat/hub-dashboard-ia`. |
| **HUB-DASH-IA-c** | **Auto** | **TODO** | Review inbox toolbar; Vault search progressive disclosure; Insights (= Overview + consolidation). |
| **HUB-DASH-IA-d** | **Auto** | **TODO** | Mobile bottom nav; onboarding/How-to copy sync; seven-tier + `/build-verification-review` → pass. |
| **HUB-DASH-IA-merge** | **Operator + Auto** | **TODO** | Tier 3 only — merge to Muse/`main` when operator authorizes. |

## Definition of Done (this lane)

- Matches frozen IA in `docs/reviews/2026-07-29-hub-dashboard-ia.md`
- Freeze review **pass** before any Auto step
- Seven-tier tests green for Hub shell contracts
- Build verification **pass** before marking a build step DONE
- Closing commit on `feat/hub-dashboard-ia` bundles code/tests + **this** roadmap + **HUB-UI-HANDOVER.md**
- Does **not** rewrite product `OVERSEER-HANDOVER` NEXT for Scooling work

## Out of scope

- SEC / FLOW-WRITE-LIVE / Delegation / Durable agent auth
- Landing marketing page (unless Hub naming consistency requires a one-line fix)
- Changing `.overseer/config.yaml` `docs.handover` / `docs.roadmap` to point here
