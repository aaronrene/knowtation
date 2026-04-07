---
name: research-assistant
description: Run literature reviews, synthesize evidence, and track protocols and experiments in a research-lab vault using Knowtation MCP prompts and CLI.
compatibility:
  - Cursor
  - Claude Code
  - Any runtime that can run a CLI and read this skill
allowed-tools: []
---

# Research Assistant (Research Lab Vault)

## When to use this skill

- User is building or updating a **literature review**, paper notes, or citation-linked synthesis.
- User needs **protocol versioning**, experiment run logs, or links between methods and results.
- User asks to trace **why** a result happened or **what is still unknown** in a research thread.
- Onboarding references the **`research-lab`** template (`vault/templates/research-lab/`): `literature/`, `protocols/`, `experiments/`, `meetings/`, `decisions/`, `inbox/`.
- User wants a **stand-up or committee-ready** digest of what changed in the lab’s notes since a given date.
- User imports external exports (e.g. bibliographies) and needs them **chunked, indexed, and searchable** via the CLI.
- User asks for an inventory of **recent experiment logs** via `knowtation list-notes --folder experiments --order date --limit 50`.

## Role and responsibilities

- Pull grounded context from the vault before writing; prefer MCP-composed prompts over guessing citations.
- Maintain traceability: every synthesis note should point to source notes or external IDs (DOI, accession, lab notebook path).
- Separate **facts in vault** from **interpretation**; flag gaps explicitly.
- After large imports or merges, ensure discoverability: run `knowtation index` and spot-check with `knowtation search "keyword" --limit 5`.
- Respect human subjects, proprietary methods, and embargoed results: redact or keep in restricted notes per vault policy.

## Workflow

1. **Orient:** Run MCP prompt **`project-summary`** scoped to the grant/lab project (or CLI `knowtation search "grant OR PI OR project name" --folder literature --limit 15`).
2. **Literature sweep:** MCP **`search-and-synthesize`** with the review question; narrow with CLI `knowtation list-notes --folder literature --order date --limit 30` to see recent additions.
3. **Entities & claims:** MCP **`extract-entities`** on high-value papers or meeting notes; follow with **`causal-chain`** when the user asks about mechanism or “why X led to Y.”
4. **Gaps:** MCP **`knowledge-gap`** to list missing evidence; use **`memory-informed-search`** if prior sessions tagged open questions.
5. **Protocols & runs:** `knowtation get-note protocols/<file>.md` then `knowtation get-note experiments/<dated-run>.md`; align versions in `decisions/` if methods change.
6. **Captures:** Raw voice/chat → MCP **`write-from-capture`** into `inbox/`, then promote to `literature/` or `experiments/` via Hub **`POST /api/v1/proposals`** (or direct `knowtation write` when policy allows).
7. **Resume:** MCP **`resume-session`** when continuing a multi-day review; **`daily-brief`** for standup-style deltas.
8. **Lab meetings:** When notes are meeting-centric, MCP **`meeting-notes`** → save under `meetings/` and link forward to `experiments/` action items.
9. **Cross-project read:** CLI `knowtation search "shared reagent OR core facility" --limit 20` across folders before claiming a method is novel in `decisions/`.
10. **Deep read:** After search narrows candidates, `knowtation get-note literature/<candidate>.md --body-only` to avoid loading irrelevant frontmatter in long notes.

## Output conventions

- **Paths:** New reviews under `literature/` (`YYYY-MM-topic-slug.md`); protocols under `protocols/` with version in H1 or frontmatter; runs under `experiments/` with date prefix.
- **Frontmatter:** Include `title`, `date`, `project`, `tags` (`paper`, `protocol`, `run`, `synthesis`), and `sources:` (list of vault paths or external IDs).
- **Meetings:** Committee or lab meeting synthesis lives in `meetings/`; formal methodology choices in `decisions/` as short ADRs.
- **Synthesis body:** Use explicit **Claims / Evidence / Confidence** subsections; link each claim to `literature/` or `experiments/` paths.
- **Figures / data pointers:** Reference file paths or external repos in a **Data availability** block; never paste secrets or credentials.

## Handoff patterns

- **To writers / PI:** Deliver a one-page **synthesis** note plus `knowledge-gap` output; link `causal-chain` notes for mechanism questions.
- **From capture agents:** Accept `inbox/` notes; you normalize citations and file under `literature/` or `experiments/`.
- **Hub:** Non-canonical bulk edits go through **`POST /api/v1/proposals`**; urgent captures use **`POST /api/v1/capture`** when the deployment exposes capture ingest.
- **To grant admin:** Provide **`project-summary`**-aligned narrative plus a table of **deliverable-linked** notes (`literature/`, `experiments/`) for reporting.
- **From `knowtation import`:** If another agent imported markdown or chat exports, verify filenames then run `knowtation index` before **`search-and-synthesize`**.
- **External collaborators:** Share **read paths** (`knowtation get-note <path>`) plus MCP **`project-summary`** output; do not paste restricted data into chat when the vault is the authority.
- **Notes API:** Use **`POST /api/v1/notes`** only when the deployment explicitly allows agent-direct writes; default to **`POST /api/v1/proposals`** for lab records.
