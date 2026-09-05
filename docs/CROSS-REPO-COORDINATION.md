# Cross-Repo Coordination And Overseer Playbook — knowtation

Status: **Coordination doc — process, not product.** Explains where work happens, how repos stay in
sync, which boundaries must not be crossed, and how to hand the overseer chat off without losing
cross-repo context.

Related:

- `docs/KNOWTATION-ROADMAP.md` — phase control + build status
- `docs/KNOWTATION-OVERSEER-HANDOVER.md` — living, always-current filled handover block
- `docs/CROSS-REPO-COORDINATION.md` — Standing Decisions (ADR) log + decision authority tiers
- `policy/tiers.yaml`, `policy/model-labels.yaml`, `policy/test-tiers.yaml` — machine-readable policy

---

## Simple summary

Governance habits (handover, roadmap, testing discipline, merge authority, model labels) must stay
consistent across connected repos. This page is the map: where each kind of change goes, what must
never break, and how one chat hands the baton to the next so the overseer view is reconstructable
from durable docs — not chat scrollback.

## Technical summary

**VCS regime for this repo:** `muse+git-mirror` (canonical: `muse`). Coordination uses:
(1) a clear ownership/decision table, (2) per-repo VCS discipline, (3) explicit non-overstep
boundaries, (4) a canonical-document map, and (5) an **overseer handover protocol** with a paste-able
state snapshot.

---

## Version control (this repo)

| Setting | Value |
| --- | --- |
| Regime | muse+git-mirror |
| Canonical | muse |
| Git remote | origin |
| Main branch | main |
| Mirror branch | muse-mirror |
| Muse staging remote | staging |
| Muse main branch | main |
| Feature branch pattern | feat/{slug} |

Shared rules: never work directly on `main`; feature branch per task; never commit
secrets or ignored paths. Say **"Muse commit"** vs **"Git commit"** explicitly when both histories apply.

### Regime-specific hard stops

| Regime | Rule |
| --- | --- |
| `muse+git-mirror` | Muse `main` before GitHub `main` (SD-14); mirror via `muse-mirror` PR only; never `git push origin main` |
| `muse-only` | **Git/GitHub forbidden** in this repo; Muse-only workflow |
| `git-only` | Canonical = Git `origin/main`; no Muse commands |

> **Cross-repo Muse safety:** when driving Muse from an agent, always use explicit
> `muse -C <absolute-repo-root> <command>` and confirm branch + HEAD before any cross-repo operation.

---

## Boundaries we do not overstep

- **Review-before-write** for durable knowledge changes.
- **No secrets** across repo boundaries — tokens, keys, and private content never in adapters, logs,
  or shared procedures.
- **Canonical-first ordering** — do not wire a consumer before the surface it reads exists.
- **Governance sync (SD-17)** — update `docs/KNOWTATION-ROADMAP.md` + `docs/KNOWTATION-OVERSEER-HANDOVER.md` before session end.

---

## Canonical documents map (this repo)

| Question | Authoritative doc |
| --- | --- |
| What phase / what's next / which model | `docs/KNOWTATION-ROADMAP.md` |
| Current filled handover block | `docs/KNOWTATION-OVERSEER-HANDOVER.md` |
| Decision authority + Standing Decisions | `docs/CROSS-REPO-COORDINATION.md` |
| Cross-repo coordination (this page) | `docs/CROSS-REPO-COORDINATION.md` |

---

## The overseer role and handover protocol

**Overseer chat** tracks state, decides what goes next, and guards boundaries. State must always be
reconstructable from **durable docs**, not chat history.

**Durable state of record:**

1. `docs/KNOWTATION-ROADMAP.md` — phase truth + build status.
2. `docs/KNOWTATION-OVERSEER-HANDOVER.md` — living filled handover block (single paste source).
3. `docs/CROSS-REPO-COORDINATION.md` — tiers + ADR log.
4. This doc — boundaries + decision table (when `docs.coordination` is configured).

**Docs-first ordering:** (1) update durable docs to match reality, (2) regenerate
`docs/KNOWTATION-OVERSEER-HANDOVER.md` from those docs, (3) emit/paste the NEXT block. Never hand-write the block
from memory ahead of the docs.

**Handover snapshot shape** (filled into `docs/KNOWTATION-OVERSEER-HANDOVER.md`):

```text
OVERSEER HANDOVER — <date/time>
Initiative + current step: <step-id>
Build order / next action: <action>

Per-repo state:
- knowtation: branch <feat/...>  last <vcs> <sha>  dirty? <y/n>

Open gates / blockers: <list>
Boundaries to honor: <list>
Links: docs/KNOWTATION-ROADMAP.md; docs/KNOWTATION-OVERSEER-HANDOVER.md
```

---

## Decision authority (three tiers)

Machine-readable copy: `policy/tiers.yaml`.

| Tier | What it covers | Behavior |
| --- | --- | --- |
| **1 — Standing defaults** | Feature-branch commits (docs or code); tests; formatting; non-destructive refactors | **Just do it.** Never on `main`; never push/merge. |
| **2 — Recommend-and-confirm** | Persistence shape; adapter contracts; schema-version choices | **Propose + recommend → one yes/no → record in Standing Decisions.** |
| **3 — Hard gates** | Merge to `main`; staging push; live capability flips; payments; secrets | **Always stop for operator authorization.** |

**Commit rule:** committing on a feature branch is Tier 1. Pushing to staging or merging to
`main` is Tier 3. Leaving durable doc edits uncommitted is the worse state.

---

## Recommended Flow: Overseer handover

Scope: session end, chat switch, or multi-repo state in flight. **Docs-first.**

| # | Step | Verification |
| --- | --- | --- |
| 1 | **Snapshot truth** — VCS status per touched repo (explicit `-C` for Muse) | Branch + sha captured |
| 2 | **Record step + next action + blockers** | Next action unambiguous |
| 3 | **List boundaries + cross-repo wiring touched** | Boundaries explicit |
| 4 | **Update durable docs FIRST** — roadmap, standing decisions if needed | Docs match reality |
| 5 | **Regenerate `docs/KNOWTATION-OVERSEER-HANDOVER.md`** from current docs; SD-3 split if Thinking → Auto | Living file matches docs |
| 6 | **Emit/paste** NEXT block into the next chat | New overseer needs no prior history |

---

## Model-split handover protocol (SD-3)

When the roadmap **Model** column for NEXT contains **`→`**, see `docs/CROSS-REPO-COORDINATION.md`
and `policy/model-labels.yaml`. Emit `{step}a` then `{step}b` — not one combined prompt.

---

## Seven-tier test contract (RULE #0)

Every Build phase that adds code ships all seven tiers. See `policy/test-tiers.yaml` for the
machine-readable matrix and what each tier must prove.
