# Muse-Style Extension — Variations, Review, and Intention

The [Muse Protocol](https://github.com/cgcardona/maestro/blob/1ded36d6321347a7b3fcca4b17009b97e4d3612f/docs/protocol/muse-protocol.md) defines a **platform-neutral protocol** for music: propose changes (variations), review them, then commit only after human approval. Canonical state does not change during review. This document explores how **Muse-style concepts** could make Knowtation more powerful for **context, memory, and intention** — the "golden thread" that makes agents fully useful — without replacing the current spec.

---

## 1. What Muse introduces (summary)

- **Variation:** A structured *proposal* to change the project (in Muse: musical edits). It is ephemeral until approved.
- **Review before commit:** Humans (or a policy) approve or discard. **Canonical state does not change** while a variation is in review.
- **Identifiers:** `projectId`, `variationId`, `baseStateId` support optimistic concurrency (reject commit if state moved on).
- **Execution modes:** e.g. COMPOSING (proposal, needs review), EDITING (apply immediately), REASONING (chat only). The backend classifies intent; frontend does not override.
- **Streaming:** Meta event first (what the variation is), then phrase/region events, then done. Single undo boundary on commit.
- **Philosophy:** "AI proposes. Humans curate."

Muse is built for music (phrases, notes, beats) but the **pattern** — propose → review → commit, with clear canonical vs proposed state — is domain-agnostic.

---

## 2. Benefits, pros/cons, and use cases

**Benefits (simple):**

- **Safer agents:** Proposals don’t touch the real vault until you approve. You see a diff and say yes or no, so agents don’t overwrite or pollute the vault by accident.
- **Explicit intention:** Each proposal can say *why* it was created (e.g. “summarize these three notes”). That reason is stored with the change and becomes part of the audit trail.
- **Clear audit:** You keep a record of what was proposed, when, by whom/what, and whether it was accepted — separate from “what ended up in the vault.”

**Pros:** Human-in-the-loop before any canonical change; intention and context preserved; supports multiple proposers (agents, users) and review workflows; one approval = one clean change (single undo boundary).

**Cons:** More moving parts (proposal store, review UI or CLI, commit/discard flow). Not everyone needs it — a single user with one agent may be fine with direct write + Git history.

**Use cases:**

- **Team or multi-agent:** Several agents or people propose edits; one person reviews and merges.
- **High-stakes vault:** Every change must go through “propose → review → commit.”
- **Preserving intent:** You want to record “this note was added because the user asked the agent to summarize X” and keep that with the change.

---

## 3. How this could apply to Knowtation (notation, not music)

Knowtation’s "project" is the **vault**: notes, frontmatter, and optionally the vector index. Today, `write` and capture **mutate the vault directly**. A Muse-style extension would add:

- **Proposed changes (variations):** Instead of writing directly to `vault/projects/foo/note.md`, an agent (or user) could create a **variation**: "here is a proposed new note" or "here are proposed edits to these notes." The variation is stored in a **proposal area** (e.g. `vault/.proposals/<variationId>/` or a sidecar store), not in the canonical vault.
- **Review then commit:** A human (or an automated policy) reviews the variation — e.g. diff view, side-by-side — and either **accepts** (variation is applied to the vault, one commit) or **discards**. Until then, canonical vault is unchanged.
- **Intention and context:** Each variation could carry **intent** (e.g. "summarize these three notes into one") and **baseStateId** (e.g. git commit hash or index version). On commit, we record that this change was approved and from which base state, giving a clear thread: intention → proposal → approval → canonical state.
- **Hub-style / multi-actor:** Like "Muse Hub" (GitHub for music), a **Knowtation Hub** could be a place where:
  - Multiple agents or users propose variations to a shared vault (or to a branch).
  - Review and merge are first-class (approve/discard, optional branching).
  - History is not just linear: you can have branches, pull requests, or "variation threads" that capture context and intention before they become canonical.

So the idea is not to turn Knowtation into Muse, but to **optionally** add a **variation/review/commit** layer on top of the vault so that:

- **Context and intention** are explicit (each variation has intent, base state, and optional explanation).
- **Memory** is preserved (what was proposed, when, and whether it was accepted).
- **Agents** can propose freely; humans (or policy) curate what actually enters the canonical knowledge base.

---

## 4. What would need to be specified (extension only)

To support this without breaking the current spec, we could define an **optional** layer:

- **Proposal store:** Where variations live (e.g. `.proposals/` under vault, or a separate store). Format: one dir per variation with proposed note(s) and metadata (variationId, baseStateId, intent, timestamp).
- **CLI or MCP:** e.g. `knowtation propose <path> [--intent "…"] [--base-state <id>]` (create variation), `knowtation variations list`, `knowtation commit <variationId>` (apply to vault), `knowtation discard <variationId>`. Optional: `knowtation diff <variationId>` to show proposed vs canonical.
- **Identifiers:** `baseStateId` could be the current Git HEAD or a content hash of the vault (or index version) so that commit is rejected if the vault has changed since the variation was created (optimistic concurrency).
- **Execution mode:** When running in "composing" or "review" mode, writes from agents go to a variation by default instead of directly to the vault; when in "editing" mode, writes apply immediately (current behavior). Config or context decides the mode.

The **existing spec** (inbox, capture, write, export, provenance, vault under Git) stays as-is. This would be an **extension** that some deployments enable (e.g. for team or agent-heavy workflows where "propose first, commit later" is required).

---

## 5. Relation to provenance and Git

- **Provenance** (which notes fed an export; AIR id for a write) stays; it applies to **canonical** exports and writes. With variations, we could also record "this commit came from variation V, intent I, base state B."
- **Vault under Git** still means the canonical vault is in a Git repo. Variations could live in the same repo (e.g. `.proposals/`) or in a separate store; when you `knowtation commit <variationId>`, the result is a normal vault change that you then commit to Git. So Git remains the history of the canonical vault; the variation layer adds an extra "proposed → approved" step before a Git commit.

---

## 6. Extract Muse vs Knowtation-only, and GitHub as an alternative

**Extract Muse vs our own implementation:**

- Muse’s *data model* is music-specific (phrases, notes, beats, tracks). Knowtation is notes/text. We’d reuse the **pattern** (variation → review → commit, baseStateId), not the music schema.
- **Option A — Knowtation-only:** Implement a variation layer in Knowtation (e.g. `.proposals/`, `propose` / `commit` / `discard`). No dependency on the Muse repo; we adopt the same ideas. Simpler, nothing shared.
- **Option B — Shared protocol:** With the Muse creator, extract a **domain-agnostic “variation protocol”** (propose → stream/review → commit/discard, identifiers, execution modes) into its own repo/spec. Muse (music) and Knowtation (notation) both implement it; different payloads, same lifecycle. Both projects benefit; one protocol to maintain.

**Can GitHub already do this?**

- **Yes, for the core workflow.** Use a branch as the “proposal”: agent (or user) works on a branch, changes vault files there, then you open a **pull request**, review the diff, and merge. That gives you: propose (branch) → review (PR) → commit (merge). Canonical state (main) doesn’t change until merge. Optimistic concurrency is handled by Git (merge conflicts if base moved).
- **What GitHub doesn’t give you by default:** Structured “intent” or “explanation” per change — you’d put that in the PR description or commit messages. So you *can* get most of the benefit with **Git + branches + PRs** and no new architecture.
- **When a Muse-style layer still helps:** (1) **No Git in the loop:** Users who don’t want to touch branches/PRs can use `knowtation propose` / `knowtation commit` with a local proposal store; we do a Git commit under the hood when they “commit.” (2) **Richer structure:** First-class “intent” and “variationId” in our format, not only in PR text. (3) **Streaming / UX:** If we want a Muse-like streaming protocol (meta, then events, then done), that’s an API design choice, not something GitHub provides.

**Bottom line:** The need *can* be filled today with **GitHub (or any Git host): agent works on a branch → you review PR → merge.** A Muse-style implementation in Knowtation is either a **convenience layer on top of that** (e.g. `propose` creates a branch and writes there; `commit` merges) or a **self-contained proposal flow** for users who prefer not to use Git directly. It doesn’t require a novel hub architecture unless you want a dedicated “Hub” product (e.g. shared vault + review UI); the same propose/review/commit idea works with plain Git + PRs.

---

## 6.1 Dedicated shared vault: what it is, and effect on agents and humans

**What “dedicated shared vault” means:**

- **Shared vault** = one vault that **multiple people and/or agents** can use. They all see the same canonical content (or the same view of it) and can propose changes. It’s “shared” in the sense that it’s not only “my local folder” — it’s a common knowledge base (e.g. a Git repo several people have access to, or a hosted service that stores the vault and exposes it via API/web).
- **Dedicated** = a **product or service built for that purpose**: a place to host the vault, have multiple contributors, run review flows, and optionally enforce roles/permissions. Think “Muse Hub for music” or “GitHub for knowledge” — a hub where the vault lives and where propose/review/commit is the main experience, rather than “everyone just uses the same Git repo and does PRs in GitHub.”

So a **dedicated shared vault** is a hosted or central “home” for the vault where:

- The vault (or a copy) is stored and served.
- Multiple humans and agents can read it, propose changes, and see each other’s proposals.
- Review and merge are first-class (UI, notifications, maybe roles).
- Optionally: access control, audit logs, and integrations.

**Effect on agents and humans:**

| Aspect | Without a shared vault (local only) | With a shared vault (e.g. shared Git repo) | With a dedicated shared-vault hub |
|--------|--------------------------------------|--------------------------------------------|-----------------------------------|
| **Humans** | One person, one vault. Others don’t see it unless they get a copy. | Several people use the same repo; they push/pull and use PRs to merge. | Same idea, but the “place” is a product: login, see vault, see proposals, review in one UI. Git can be hidden. |
| **Agents** | Agent writes to the local vault (or to a local proposal store). Only that user sees it. | Agents can run in different contexts (e.g. per user or per branch) and propose via branches/PRs. | Agents authenticate or are scoped to the hub; their proposals show up in the same review queue as human proposals. |
| **Interaction** | Human ↔ agent on one machine. | Humans and agents interact *through* the vault: propose (branch/PR), review, merge. Coordination is via Git + host (e.g. GitHub). | Same, but coordination is through the hub’s API and UI. You can have one “review queue,” notifications, and a single place to see “who proposed what.” |

So a **shared vault** (in any form) is what lets **multiple actors** — humans and agents — **interact through the same knowledge base**: by proposing changes, reviewing, and committing. The **dedicated hub** is the version where that experience is a purpose-built product (hosted vault + review UI + optional extras) instead of “Git repo + GitHub (or similar).”

**Is it worthwhile to layer this on top of what we’re building?**

- **Core Knowtation** = one vault, one CLI (and optional MCP), propose/commit optional. That works for a single user and one or more agents on one machine, and it already works with “vault in a Git repo” so you can push to GitHub and get backup and history.
- **Shared vault “on the cheap”** = put the vault in a **shared Git repo** (e.g. on GitHub). Multiple people (and agents running for them) clone, work on branches, open PRs, review, merge. No new product: Knowtation + Git + GitHub (or GitLab, etc.) already give you multi-actor interaction. **Worth doing:** yes, if you want team or multi-agent use — just use a shared repo and PRs.
- **Dedicated shared-vault hub** = build (or use) a **hosted service** that stores the vault, exposes it via API, and provides a review UI, notifications, maybe roles. That’s a **separate product or layer** on top of the Knowtation spec (the hub consumes the same vault format and, if we add it, the same propose/commit contract). **Worth it** when: (1) you want a single place for “knowledge base + proposals + review” without asking users to use Git/PRs, or (2) you want features that go beyond Git (e.g. fine-grained permissions, branded review UX, deep integrations). It’s **not required** for agents and humans to interact — they can do that today with a shared repo and PRs. The hub is a **convenience and product layer** for teams or orgs that want a dedicated “knowledge hub” experience.

**Summary:** A shared vault (shared repo or dedicated hub) is what enables multiple humans and agents to interact *through* the same vault via propose/review/commit. You can get that today with a shared Git repo and PRs. A *dedicated* shared-vault hub is an optional layer on top of what we’re building — worthwhile if you want a productized “knowledge hub” experience; not necessary for basic multi-actor interaction.

---

## 7. Next steps (for the spec)

- **Short term:** Keep the current spec as-is. Document this as an **extension idea** (this file) and add a pointer in SPEC §12 (extension points): "Optional: Muse-style variation/review/commit layer for proposed vault changes; see docs/MUSE-STYLE-EXTENSION.md."
- **Later:** If we implement it, add a small **proposal/variation** contract (where proposals live, format, and how commit/discard work) and optional CLI commands. A "Muse Hub–style" service (shared vault, multiple proposers, review UI) would be a separate product or service that consumes this contract.

This way we keep notation simple and compatible for everyone, while leaving a clear path to a GitHub-style, intention-preserving, review-before-commit workflow for power users and teams.
