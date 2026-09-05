# Side check — Hub dashboard IA (signed-in UX)

**Date:** 2026-07-29  
**Kind:** Hub UI lane freeze (Check OK honesty path)  
**Branch:** `feat/hub-dashboard-ia`  
**Lane docs (use these, not product Overseer):**  
[`docs/HUB-UI-ROADMAP.md`](../HUB-UI-ROADMAP.md) · [`docs/HUB-UI-HANDOVER.md`](../HUB-UI-HANDOVER.md)  
**Honesty:** same Freeze-Contract + build-verification path as roadmap phases  
**Model for freeze review:** Thinking / thinking-high  
**Model for build:** Auto (only after freeze `pass`)

## Freeze-contract declaration

```yaml
phase: check-ok-hub-dashboard-ia
outputs:
- id: side-check
  path: docs/reviews/2026-07-29-hub-dashboard-ia.md
  frozen: true
frozen_inputs: []
review_stamp:
  reviewed_at: '2026-07-29T13:12:07Z'
  verdict: pass
  reviewer_mode: agent
  reviewer_model: thinking-high
  reviewer_provider: local
  kit_version: 0.1.0
  artifact_digest: sha256:c65a3274d67115079f6cb72d5a1f5c494b2cec5f4b712f6c503344641e9138dd
tier3_gates:
- T1 merge to Muse main or muse-mirror → GitHub main (SD-14)
- T2 any change to proposal API contracts, roles, or approve/discard authorization
```

## Operator decisions (ratified 2026-07-29)

| Decision | Choice |
| --- | --- |
| Queue name | **Review** (retire user-facing “Suggested”) |
| Discarded placement | Under **History** (not top-level rail) |
| Vault urgency | **Needs you** banner when `proposed` count > 0 → opens Review |
| Branch | Clean **`feat/hub-dashboard-ia`** from current `main` |

## Scope — signed-in Hub only

Rework the logged-in Hub shell (`web/hub/index.html`, `web/hub/hub.css`, `web/hub/hub.js` and related copy in onboarding / How to use) so navigation matches product mental models: vault browsing vs agent/human proposal review.

### Target information architecture

```text
Left rail (primary)
  Vault          → today’s Notes (list / calendar; search lives here)
  Review  (N)    → proposed queue (data-tab=suggested; badge = unfiltered proposed count)
  History        → segmented: Activity | Discarded

Left rail (secondary / footer)
  Insights       → today’s Overview (data-view=graph / #notes-view-graph) + #consolidation-card
  Import         → existing #modal-import
  Connect        → openSettingsIntegrationsTab() (data-settings-tab=integrations)
  Settings
  Help           → How to use (#modal-how-to-use / #btn-how-to-use)

Vault home (when proposed > 0)
  “Needs you” banner → switchHubMainTab('suggested') / Review mode
```

### Must preserve (non-negotiable)

- Internal `data-tab` values: `notes | suggested | activity | problem` (or thin aliases that still call `switchHubMainTab` / `loadProposals` / `loadActivity` / `loadNotes`)
- `#btn-header-suggested` behavior → Review (`switchHubMainTab('suggested')`)
- Proposal create / evaluate / approve / discard / enrich semantics and RBAC
- All Settings tabs and How to use content (may relocate entry points; do not delete features)
- Critical IDs / hooks (inventory below) — do not rename or remove without an explicit migration note in this freeze

### Critical IDs / hooks inventory

#### Navigation / lists

- `switchHubMainTab(name)` — `notes|activity|suggested|problem`
- `[data-tab="…"]` and `#tab-notes|#tab-activity|#tab-suggested|#tab-problem`
- `loadProposals()` → `#proposals-suggested` / `#proposals-problem`; empty `#empty-suggested-how-to`
- `loadActivity()` → `#proposals-activity`, `#empty-activity-goto-suggested`
- `openProposal(id)`, `openNote(path)`
- `#btn-header-suggested`, `#btn-new-proposal`, `#proposal-filters-bar`, proposal filter IDs
- `refreshNewProposalTabVisibility()`, `setProposalFiltersBarVisible()`
- Browse: `[data-view="list|calendar|graph"]`, `#hub-list-sort`, `#notes-view-graph`, `#dashboard-cards`

#### Shell / auth

- `#main`, `#login-required`, `#hub-auth-buttons`, `#vault-switcher`
- `#btn-new-note`, `#btn-import`, `#btn-settings`, `#btn-how-to-use`, `#btn-logout`

#### Detail

- `#detail-panel`, `#detail-title`, `#detail-body`, `#detail-actions`
- `#btn-copy-path`, `#btn-detail-copy-body`, `#detail-close`, `[data-hub-detail-close]`
- Proposal: `#proposal-eval-*`, `#proposal-waiver-reason`, `#proposal-open-note-btn`, `#proposal-eval-save`
- Note edit: `#detail-edit-*`

#### Modals / settings / howto

- `#modal-create`, `#modal-import`, `#modal-create-proposal`, `#modal-onboarding`, `#modal-settings`, `#modal-how-to-use`, `#modal-projects-help`, `#modal-integ-guide`
- `data-settings-tab` / `#settings-panel-*`, `#settings-tab-team`, `#settings-tab-vaults`
- `openSettings()`, `openSettingsIntegrationsTab()`, `openSettingsBillingTab()`, `openSettingsConsolidationTab()`
- `data-how-to-tab` / `#how-to-panel-*`
- Consolidation: `#consolidation-card`, `#btn-consol-now|#btn-consol-history|#btn-consol-settings`
- Search/index: `#search-query`, `#search-mode`, `#btn-search`, `#btn-clear-search`, `#btn-apply-filters`, `#btn-reindex`, `#hub-index-status`, `#browse-toolbar`
- Empty vault: `#hub-empty-vault-strip`, `#btn-empty-strip-wizard`, `#btn-empty-strip-getting-started`
- Onboarding: `#onboarding-step-body`, `#btn-onboarding-next|back|skip`

#### Globals often set from settings payload

`window.__hubUserRole`, `__hubProposalEvaluationRequired`, `__hubProposalReviewHints`, `__hubProposalEnrich`, `__hubEvaluatorMayApprove`, `__hubProposalRubricItems`

### User-facing rename (required)

Every user-visible string that says **Suggested** for the proposal queue becomes **Review**, including:

- Rail / header labels (already partially “Review” on experimental branch; main may still say Suggested)
- Empty states (`empty-state-suggested`, Activity “Open Suggested tab”)
- Onboarding step “Proposals and the Suggested queue”
- How to use / search-key copy where it names the Hub tab
- Docs links in Hub UI only (repo markdown docs can follow in same PR if touched)

Internal IDs (`suggested`, `proposals-suggested`) may remain for stability unless a follow-up migration is explicit. Path-typo helpers that say “suggested path/slug” are out of scope (not the proposal queue).

### Fail-closed / non-goals

- No change to proposal API contracts, roles, or approve/discard authorization
- No mega-menu of every Settings subsection in the rail
- No React rewrite in v1 of this freeze
- No merge to `main` without Tier 3
- Landing marketing page out of scope unless copy must say Review for Hub consistency

## Expert UX recommendations (beyond operator decisions)

These are **in scope as recommended defaults** for Auto unless the operator strikes them before freeze review `pass`. Phase ownership is in **Implementation phases** below — every numbered item maps to a build step.

### A. Review inbox (highest leverage)

1. **Count badge** on rail Review + header Review — integer of unfiltered `proposed` count only (not Activity; not the filtered list length).
2. **Review mode toolbar** — hide note search/filters; show proposal filters + New proposal by default.
3. **Row density** — path, source chip, pending-eval chip, relative time; keyboard ↑↓ Enter.
4. **Split view** — selecting a Review row opens detail without losing list context (already true; ensure focus ring + “N of M”).
5. **Primary actions in detail first** — Evaluate / Approve / Discard visually above long diffs.
6. **Pending evaluation filter chip** one click from Review empty/full states when policy requires eval.

### B. Vault mode

7. **Needs you banner** — copy: “N proposals waiting in Review”; dismiss for session only (`sessionStorage`); never hide the rail badge.
8. **Search-first command bar** — Meaning/Keyword + Search/Clear always; advanced filters collapsed until opened or active.
9. **Browse modes as segmented control** under Vault only (List | Calendar) — move Overview → Insights (keep internal `data-view="graph"`).

### C. History mode

10. **Segmented control:** Activity | Discarded inside History (one rail item).
11. Default segment = Activity; remember last segment in `localStorage`.

### D. Progressive disclosure

12. **Connect** = `openSettingsIntegrationsTab()` (agents, MCP, credentials, cloud agent) — not buried only under Settings gear.
13. **Insights** holds Overview charts + `#consolidation-card` (stop requiring Overview tab discovery).
14. Keep Backup / Billing / Appearance / Team / Vaults inside Settings modal.

### E. Language & hierarchy

15. Global glossary in Hub chrome: **Vault** (notes), **Review** (queue), **History** (timeline + discarded).
16. Avoid “Suggested”, “Problem”, “Graph” in user-facing Hub strings (internal `data-tab` / `data-view` values may stay).
17. Empty Review state: one primary CTA (**New proposal**) + one secondary (**How Review works**).

### F. Motion / polish (keep light)

18. Rail active state: inset accent bar (not underline tabs).
19. Badge pulse once when count increases (respect `prefers-reduced-motion`).
20. Mobile: bottom nav = Vault | Review(N) | History | More (Import/Connect/Settings/Help).

### G. Explicitly deferred (not v1)

- Attestation interactive UI
- Full kanban for proposals
- AI summary of the Review queue
- Drag-and-drop approve
- Redesign of Settings internals (except deep-links)

## Ground-truth edge

Downstream Auto may treat this document as ground truth for Hub shell IA without re-deriving operator decisions. Session control for this work is **`HUB-UI-ROADMAP.md` + `HUB-UI-HANDOVER.md`**, not the product `KNOWTATION-OVERSEER-HANDOVER.md` / Scooling baton.

## Test matrix (seven tiers)

| Tier | Expectation |
| --- | --- |
| unit | Label map Review; History segment helpers; badge = unfiltered `proposed` count (independent of active list filters) |
| integration | `switchHubMainTab('suggested')` still loads `#proposals-suggested`; Discarded via History segment → `problem`; Connect calls `openSettingsIntegrationsTab()` |
| e2e (static contract) | Rail order Vault → Review → History; Needs-you banner markup + target; no user-facing “Suggested” tab/queue label in `web/hub/` |
| stress | Badge update safe when proposed count is 0–100 |
| data-integrity | Tab `data-tab` values and critical IDs unchanged; proposal status filters unchanged |
| performance | Advanced filters default-collapsed on Vault; Review does not mount note filter row |
| security | No new inline handlers with unsanitized HTML; RBAC for Approve/Discard unchanged; no secrets in UI |

Every freeze-review finding MUST cite **file+line**.

## Implementation phases (after freeze `pass`)

| Step | Model | Deliverable | Expert items |
| --- | --- | --- | --- |
| HUB-DASH-IA-a | Thinking | This freeze + `/freeze-review-loop` → `pass` | — |
| HUB-DASH-IA-b | Auto | Shell: left rail, History segments, Needs-you, Review rename, badge, Connect/Import/Help/Settings rail entries, rail accent | 1, 7, 9 (Vault List\|Calendar only), 10–12, 14–16, 18–19 |
| HUB-DASH-IA-c | Auto | Review inbox toolbar + row/detail polish; Vault search progressive disclosure; Insights (= Overview + consolidation) | 2–6, 8, 13, 17 |
| HUB-DASH-IA-d | Auto | Mobile bottom nav; onboarding/How-to copy sync; seven-tier green + `/build-verification-review` → pass | 20 + copy/BV |

## Review record

| Round | Reviewer | Verdict | Resolution |
| --- | --- | --- | --- |
| — | — | pending | Operator decisions recorded; awaiting freeze-review |
| 1 | Freeze-review loop (thinking-high) | findings | **F1** `…ia.md:61` completeness — “inventory” cited but absent → embed Critical IDs. **F2** `…ia.md:141` consistency — badge “list length” vs unfiltered `proposed` → align matrix + expert. **F3** `…ia.md:151-158` completeness — expert A3–A5 / F18–F19 unmapped to phases → phase ownership column. **F4** `…ia.md:47` completeness — Connect deep-link unnamed → `openSettingsIntegrationsTab()`. **F5** `…ia.md:41` consistency — “today’s Suggested” vs rename → “proposed queue (data-tab=suggested)”. Fixes applied. |
| 2 | Freeze-review loop (thinking-high) | findings | **F6** `…ia.md:98` completeness — Vault search IDs incomplete for item 8 → add `#search-mode`, `#btn-apply-filters`, `#browse-toolbar`. Fix applied. |
| 3 | Freeze-review loop (thinking-high) | pass | C1–C8 clear; mechanical ChecklistEngine (kit local provider heuristics) 0 findings; semantic pass. `review_stamp` written. Auto may start **HUB-DASH-IA-b**. |
