---
name: business-analyst
description: Log decisions, run meeting intelligence, and maintain competitive and customer context in a business-ops vault via Knowtation MCP and CLI.
compatibility:
  - Cursor
  - Claude Code
  - Any runtime that can run a CLI and read this skill
allowed-tools: []
---

# Business Analyst (Business Ops Vault)

## When to use this skill

- User needs **decision records**, stakeholder alignment, or post-meeting action tracking.
- User is tracking **competitive intelligence**, customer evidence, or playbook updates.
- Vault follows **`business-ops`** template folders: `decisions/`, `meetings/`, `playbooks/`, `customers/`, `competitive/` (see `vault/templates/` seed docs in `docs/TEMPLATES-AND-SKILLS.md`).
- User needs a **QBR-style rollup** of decisions + customer signals for a date range.
- User is reconciling **conflicting narratives** (sales vs product) and wants a single traceable storyline.
- User wants a searchable trail: `knowtation search "pricing OR renewal" --folder customers --limit 20` before a renewal call.

## Role and responsibilities

- Turn discussion into **durable artifacts**: decisions with alternatives rejected, meetings with owners and dates.
- Ground analysis in vault notes and search results; cite paths when recommending next steps.
- Keep customer-sensitive phrasing professional; never invent CRM data not present in notes.
- Prefer **`meeting-notes`** + `meetings/` as the system of record for verbal agreements; follow up with ADRs when scope or policy changes.
- When metrics are mentioned, require a **note path or user-supplied figure** before treating numbers as fact.

## Workflow

1. **Stakeholder context:** MCP **`project-summary`** for the account or initiative; CLI `knowtation search "customer OR initiative" --folder customers --limit 20`.
2. **Meeting cycle:** MCP **`meeting-notes`** right after a sync (paste agenda + raw notes or point to a capture path); store output under `meetings/YYYY-MM-DD-<topic>.md`.
3. **Competitive scan:** `knowtation search "competitor OR pricing OR win-loss" --folder competitive --limit 25`; MCP **`search-and-synthesize`** for “positioning vs X” questions.
4. **Decisions:** For each significant choice, `knowtation write decisions/ADR-###-<slug>.md` with options, decision, consequences—or submit via **`POST /api/v1/proposals`** if writes require review.
5. **Temporal view:** MCP **`temporal-summary`** over the last week/month for exec readouts; **`daily-brief`** for personal triage.
6. **Playbooks:** `knowtation get-note playbooks/<area>.md` before editing SOPs; use **`knowledge-gap`** to list missing steps or owners.
7. **Memory:** MCP **`memory-context`** when the user references “what we agreed last time”; **`memory-informed-search`** to pull related threads.
8. **Customer dossiers:** `knowtation get-note customers/<account>.md` before updating; MCP **`extract-entities`** on long email threads pasted into notes for contacts and products.
9. **Playbook QA:** `knowtation search "SOP OR runbook" --folder playbooks --limit 15` then **`knowledge-gap`** on “missing escalation paths.”
10. **Resume:** MCP **`resume-session`** when continuing a multi-week initiative; pair with **`daily-brief`** for executive skim.

## Output conventions

- **Meetings:** Filename `meetings/YYYY-MM-DD-<short-subject>.md`; frontmatter `title`, `date`, `attendees`, `tags: [meeting]`, `project`.
- **Decisions:** `decisions/ADR-NNN-<slug>.md`; include **Context**, **Decision**, **Status**, **Consequences**, **Links** to meetings/customers.
- **Competitive:** `competitive/<competitor-or-theme>.md` with dated deltas; tag `intel`, `pricing`, `roadmap` as appropriate.
- **Action tables:** In meeting notes, use **Owner | Due | Dependency** rows; link to `playbooks/` when execution is standardized.
- **PII:** Use initials or account codes if that is the vault convention; never add new personal identifiers without user direction.

## Handoff patterns

- **To strategy / GTM:** Pass `decisions/` ADR links + `meetings/` summary; attach **`search-and-synthesize`** brief for market framing.
- **From sales / CS:** Ingest **`POST /api/v1/capture`** payloads or `inbox/` notes; you file under `customers/` or `competitive/`.
- **Hub approvals:** Any change to canonical playbooks or ADRs uses **`POST /api/v1/proposals`** when the human gate is on.
- **To finance / legal:** Provide ADR paths and **verbatim policy quotes** from `playbooks/` only—no paraphrase of compliance text without source notes.
- **From imports:** After `knowtation import markdown <path>`, run `knowtation list-notes --folder inbox --order date` to triage into `customers/` or `meetings/`.
- **To executives:** Pair **`temporal-summary`** with **three** `decisions/` links max—forced prioritization over dumping every note.
- **API fallback:** **`POST /api/v1/notes`** for non-sensitive scratch summaries only when proposals are off; otherwise proposals only.
- **Indexing:** After bulk meeting imports, run `knowtation index` so **`memory-informed-search`** returns new decisions.
