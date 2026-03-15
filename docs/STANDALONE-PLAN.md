# Knowtation — Standalone Product & Architecture Plan (March 2026)

This document defines **Knowtation** (*know* + *notation*) as a **standalone, general-purpose tool**: CLI + Skill Manifest first, optional MCP, with memory and intent attestation (AIR) for full multimedia launch scenarios. It is the product and architecture spec for this repository.

---

## 1. Knowtation as a Standalone Product

- **Knowtation** is its own repository and its own tool. It is a general-purpose **personal knowledge and content system** that anyone can use.
- **Value proposition:** One place to capture, transcribe, index, and search notes and media; one CLI (and optional MCP) so many AI agents can use it without tool-definition context bloat; optional **memory** and **AIR** for traceable, authorized workflows.
- **Users:** Individuals and teams who want to own their knowledge base and run multimedia workflows (blogs, podcasts, reels, books, marketing, analysis) with clear provenance and governance.

## 2. CLI + Skill Manifest First, MCP When Needed

- **Primary interface:** One CLI, `knowtation`, with subcommands (`search`, `get-note`, `list-notes`, `index`, `write`, `export`). Full surface in **docs/SPEC.md**. Agents discover usage via **SKILL.md** and `knowtation --help`; no large MCP schema in context.
- **MCP optional:** Offer an MCP server that wraps the same backend when a client only speaks MCP or you need stateful sessions / OAuth.
- **Orchestration:** The agent runtime (Cursor, Claude, etc.) discovers the skill, reads SKILL.md when the task matches, and invokes the CLI; no separate orchestration service.

## 3. Memory and AIR

- **Memory:** One supported layer (e.g. Mem0 or SAME) for decisions, provenance (“which notes fed this export”), and cross-session context. Expose via CLI (and MCP if present).
- **AIR:** Pre-execution intent attestation (e.g. Null Lens) recommended before write (except inbox), export, publish, and analysis. Log AIR id with the action.

See the full scenario coverage (capture → index → search → content → marketing → analysis → governance) and tool options in the sections below and in the repo docs.

## 4. Scenario Coverage (Summary)

- **Capture:** Inbox and transcription; optional memory for rules.
- **Index & search:** CLI returns ranked notes/chunks; memory for last index.
- **Content creation:** Export to blog/podcast/reel/book; provenance (`source_notes`); AIR before export.
- **Marketing:** Agents pull copy/assets from Knowtation; memory for campaigns; AIR before approve/schedule.
- **Analysis:** Agents query Knowtation; memory for last run; AIR before analysis.
- **Governance:** Logging, agent-generated tags, provenance chain.

## 5. Next Steps in This Repo

1. Implement CLI subcommands (wire to vault and vector store).
2. Add indexer (vault → chunk → embed → Qdrant or sqlite-vec).
3. Add transcription and capture pipelines.
4. Integrate memory and AIR as in this plan.
5. Optionally add MCP server that wraps the same backend.

---

*Full detailed plan (tables, comparisons, novel AIR uses) is kept in the originating doc; this file is the in-repo summary and reference.*
