# Plan: Auto-labeling and project assignment for incoming documents

**Status:** Backlog / planning. Not implemented.

---

## Problem

When notes or documents enter the vault (via Hub “New note”, Quick capture, Import, Capture webhook, or CLI), metadata (project, tags, date, causal_chain_id, entity, episode_id) is either:

- **Manual** — user fills fields in the UI or frontmatter.
- **Convention** — path under `projects/<name>/` infers project; importers may set project from source.

There is no automatic inference of project, tags, or other labels from **document content**. Users have asked: how will metadata be filled out at scale, and can we infer it from the document?

---

## Goals (for a future implementation)

1. **On ingest:** When a new note or document is created (or imported), optionally infer or suggest:
   - **Project** — from content, path, or rules.
   - **Tags** — from content or entity extraction.
   - **Date** — from content or file metadata.
   - **Temporal/hierarchical** — causal_chain_id, entity, episode_id where useful.

2. **Quality:** Suggestions should be correct often enough to reduce manual work without forcing wrong labels.

3. **Transparency:** User (or admin) should be able to see why a label was suggested (e.g. “matched rule X” or “LLM extraction”).

---

## Possible approaches

| Approach | Pros | Cons |
|----------|------|------|
| **Rules / heuristics** | No external API, fast, deterministic. E.g. “path contains X → project Y”; “title contains date pattern → date”. | Limited to patterns we encode; doesn’t scale to arbitrary content. |
| **LLM-based extraction** | Can infer project, tags, entities from body text. Flexible. | Cost, latency, need prompt + schema; may hallucinate; requires provider (OpenAI, Ollama, etc.). |
| **Hybrid** | Rules for path/source; LLM for body when enabled. | More moving parts; need clear precedence (rule overrides LLM or vice versa). |
| **Manual only + better UX** | No new backend; improve UI (default path by project, templates). | Doesn’t solve “auto” ask; still manual. |

---

## Scopes to consider

1. **Hub “New note” / Quick capture** — Before or after save, run an optional “suggest metadata” step (rules or LLM); prefill or show suggestions for project, tags, etc.
2. **Import pipeline** — After a file is converted to a note, run the same suggestion step and optionally write frontmatter.
3. **Capture webhook** — Incoming messages could be tagged by source or by a small rule set (e.g. Slack channel → project).
4. **Bulk “tag existing notes”** — Background job or CLI that scans notes with missing/minimal metadata and suggests or applies labels (with dry-run and review).

---

## Dependencies and constraints

- **Config:** If LLM is used: embedding/search may already have a provider; same or separate model for “extract metadata” (e.g. a small LLM call per note).
- **Privacy:** Document content would be sent to the chosen LLM provider if we use LLM extraction; document in privacy policy and make it opt-in or per-deployment.
- **Idempotency:** Re-running suggestion on the same note should be safe (overwrite or merge with user-set values? Policy: e.g. “only fill empty fields” or “suggest only when empty”).

---

## Suggested next steps (when prioritized)

1. **Document current behavior** — Where project/tags come from today (path, frontmatter, import source). Already partly in SPEC and MULTI-VAULT; add a short “Metadata sources” subsection.
2. **Define a minimal “suggestion” contract** — Input: note path + body + existing frontmatter. Output: suggested project, tags, date, etc. One implementation could be rules; a later one LLM.
3. **Implement rules-based suggester first** — E.g. path prefix → project; optional regex or keyword rules in config. No new services.
4. **Optional LLM module** — Behind a feature flag or config key; call model with a prompt + note body; parse response into suggested frontmatter; present in UI or apply on import with consent.
5. **Hub UI** — “Suggest” button or auto-suggest on New note / Import; show suggested fields for user to accept or edit.

---

## References

- **SPEC** §1–2 (frontmatter, project, tags).
- **MULTI-VAULT-AND-SCOPED-ACCESS.md** — scope uses project/folder.
- **Import pipeline** — `lib/import.mjs`, importers; some already set project from source.
