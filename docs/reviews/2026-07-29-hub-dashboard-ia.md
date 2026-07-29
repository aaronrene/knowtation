# Side check — Hub dashboard IA (signed-in UX)

**Date:** 2026-07-29  
**Kind:** ad-hoc Check OK (not a roadmap lane)  
**Branch:** `feat/hub-dashboard-ia`  
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
  Review  (N)    → today’s Suggested (data-tab=suggested; badge = proposed count)
  History        → segmented: Activity | Discarded

Left rail (secondary / footer)
  Insights       → today’s Overview browse mode + consolidation card
  Import         → existing #modal-import
  Connect        → Settings → Integrations deep-link
  Settings
  Help           → How to use

Vault home (when proposed > 0)
  “Needs you” banner → switchHubMainTab('suggested') / Review mode
```

### Must preserve (non-negotiable)

- Internal `data-tab` values: `notes | suggested | activity | problem` (or thin aliases that still call `switchHubMainTab` / `loadProposals` / `loadActivity` / `loadNotes`)
- `#btn-header-suggested` behavior → Review
- Proposal create / evaluate / approve / discard / enrich semantics and RBAC
- All Settings tabs and How to use content (may relocate entry points; do not delete features)
- Critical IDs listed in inventory (detail panel, modals, proposal containers, filters)

### User-facing rename (required)

Every user-visible string that says **Suggested** for the proposal queue becomes **Review**, including:

- Rail / header labels (already partially “Review” on experimental branch; main may still say Suggested)
- Empty states (`empty-state-suggested`, Activity “Open Suggested tab”)
- Onboarding step “Proposals and the Suggested queue”
- How to use / search-key copy where it names the Hub tab
- Docs links in Hub UI only (repo markdown docs can follow in same PR if touched)

Internal IDs (`suggested`, `proposals-suggested`) may remain for stability unless a follow-up migration is explicit.

### Fail-closed / non-goals

- No change to proposal API contracts, roles, or approve/discard authorization
- No mega-menu of every Settings subsection in the rail
- No React rewrite in v1 of this freeze
- No merge to `main` without Tier 3
- Landing marketing page out of scope unless copy must say Review for Hub consistency

## Expert UX recommendations (beyond operator decisions)

These are **in scope as recommended defaults** for Auto unless the operator strikes them before freeze review `pass`.

### A. Review inbox (highest leverage)

1. **Count badge** on rail Review + header Review — integer of `proposed` only (not Activity).
2. **Review mode toolbar** — hide note search/filters; show proposal filters + New proposal by default.
3. **Row density** — path, source chip, pending-eval chip, relative time; keyboard ↑↓ Enter.
4. **Split view** — selecting a Review row opens detail without losing list context (already true; ensure focus ring + “N of M”).
5. **Primary actions in detail first** — Evaluate / Approve / Discard visually above long diffs.
6. **Pending evaluation filter chip** one click from Review empty/full states when policy requires eval.

### B. Vault mode

7. **Needs you banner** — copy: “N proposals waiting in Review”; dismiss for session only (`sessionStorage`); never hide the rail badge.
8. **Search-first command bar** — Meaning/Keyword + Search/Clear always; advanced filters collapsed until opened or active.
9. **Browse modes as segmented control** under Vault only (List | Calendar) — move Overview → Insights.

### C. History mode

10. **Segmented control:** Activity | Discarded inside History (one rail item).
11. Default segment = Activity; remember last segment in `localStorage`.

### D. Progressive disclosure

12. **Connect** = Integrations deep-link (agents, MCP, credentials, cloud agent) — not buried only under Settings gear.
13. **Insights** holds Overview charts + consolidation card (stop requiring Overview tab discovery).
14. Keep Backup / Billing / Appearance / Team / Vaults inside Settings modal.

### E. Language & hierarchy

15. Global glossary in Hub chrome: **Vault** (notes), **Review** (queue), **History** (timeline + discarded).
16. Avoid “Suggested”, “Problem”, “Graph” in user-facing Hub strings.
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

Downstream Auto may treat this document as ground truth for Hub shell IA without re-deriving operator decisions. Promote to a ROADMAP lane only if the work becomes a durable multi-phase program.

## Test matrix (seven tiers)

| Tier | Expectation |
| --- | --- |
| unit | Label map Review; History segment helpers; badge count from proposal list length |
| integration | `switchHubMainTab('suggested')` still loads `#proposals-suggested`; Discarded via History segment → `problem` |
| e2e (static contract) | Rail order Vault → Review → History; Needs-you banner markup + target; no user-facing “Suggested” tab label in `web/hub/` |
| stress | Badge update safe when loadProposals returns 0–100 items |
| data-integrity | Tab `data-tab` values unchanged; proposal status filters unchanged |
| performance | Advanced filters default-collapsed on Vault; Review does not mount note filter row |
| security | No new inline handlers with unsanitized HTML; RBAC for Approve/Discard unchanged; no secrets in UI |

Every freeze-review finding MUST cite **file+line**.

## Implementation phases (after freeze `pass`)

| Step | Model | Deliverable |
| --- | --- | --- |
| HUB-DASH-IA-a | Thinking | This freeze + `/freeze-review-loop` → `pass` |
| HUB-DASH-IA-b | Auto | Shell: rail + History segments + Needs-you + Review rename + badge |
| HUB-DASH-IA-c | Auto | Review inbox toolbar + Vault search progressive disclosure + Insights |
| HUB-DASH-IA-d | Auto | Mobile bottom nav + onboarding/How-to copy sync + seven-tier green + BV |

## Review record

| Round | Reviewer | Verdict | Resolution |
| --- | --- | --- | --- |
| — | — | pending | Operator decisions recorded; awaiting freeze-review |
