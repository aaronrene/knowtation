# Hub UI Roadmap — Knowtation (signed-in dashboard)

**Lane:** Hub UI redesign only.  
**Not** the product/security board (`docs/KNOWTATION-ROADMAP.md` / Scooling).  
**Not** wired as `.overseer/config.yaml` → `docs.roadmap` (that stays the product roadmap).

Use this file + [`HUB-UI-HANDOVER.md`](./HUB-UI-HANDOVER.md) for any session that redesigns the **signed-in Hub**. Product NEXT stays on `docs/KNOWTATION-OVERSEER-HANDOVER.md`.

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
| [`docs/reviews/2026-07-29-hub-dashboard-ia.md`](./reviews/2026-07-29-hub-dashboard-ia.md) | **Frozen IA** (`frozen: true`, `review_stamp.verdict: pass`) — operator decisions + expert defaults + critical ID inventory. |

## Build queue

| Phase | Model | Status | Deliverable |
| --- | --- | --- | --- |
| **HUB-DASH-IA-a** | **Thinking** | **DONE 2026-07-29** — freeze-review-loop round 3 = **pass** | Ratify IA: Vault / Review(N) / History; Discarded under History; Needs-you banner; retire user-facing “Suggested”. Artifact: `docs/reviews/2026-07-29-hub-dashboard-ia.md`. |
| **HUB-DASH-IA-b** | **Auto** | **DONE 2026-07-29** — shell + seven-tier green; BV covered under **d** | Shell: left rail, History segments, Needs-you, Review rename, badge, Connect/Import/Help/Settings/Insights rail entries, rail accent + badge pulse. Branch: `feat/hub-dashboard-ia`. Expert items 1, 7, 9–12, 14–16, 18–19. Tests: `test/hub-dashboard-ia-shell.test.mjs`. |
| **HUB-DASH-IA-c** | **Auto** | **DONE 2026-07-29** — inbox + search + Insights; seven-tier green; BV covered under **d** | Review inbox toolbar + row/detail polish; Vault search progressive disclosure; Insights (= Overview + consolidation). Expert items 2–6, 8, 13, 17. Tests: `test/hub-dashboard-ia-inbox.test.mjs`. |
| **HUB-DASH-IA-d** | **Auto** | **DONE 2026-07-29** — mobile bottom nav + copy polish; seven-tier green; **`/build-verification-review` → pass** (covers b+c+d) | Mobile bottom nav Vault \| Review(N) \| History \| More (Import/Connect/Settings/Help; Insights relocated into More on mobile); onboarding/How-to glossary sync. Expert item 20. Tests: `test/hub-dashboard-ia-mobile.test.mjs` (+ reaffirm shell/inbox). |
| **HUB-DASH-IA-polish** | **Operator + Auto** | **DONE 2026-07-29** — post-BV operator review fixes | Active-vault switcher in rail (always visible); header above detail panel; notes default half-page; **Quick tags** label; search row condensed; rail clustered (no tall gap); onboarding auto-popup off (How to use only); brand `Knowtation` + small gray **HUB**. |
| **HUB-DASH-IA-merge** | **Operator + Auto** | **DONE 2026-07-31** — imported to Muse feature branch `feat/hub-dashboard-ia` on the Muse-capable machine (suites 58/58 local re-run); landed Muse/`main` → muse-mirror PR #286 (green CI) | Tier 3 — Muse/`main` then muse-mirror → GitHub `main` (SD-14). Shell not redesigned; import was file-exact from GitHub `5230949..55fe2c5`. |
| **HUB-HELP-UX** (optional follow-on) | **Thinking → Auto** | **TODO** — not blocking merge | School/Scooling-friendly How to use + Integrations presentation (audience tabs, plain verbs, Hub API first). Separate freeze if operator green-lights. |

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
