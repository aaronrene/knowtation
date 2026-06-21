# Starter Flows (user-owned seeds)

A small, **user-owned, fully editable** set of starter Flows — the same way Knowtation ships
vault templates and skill packs. They are **seeds, not constraints**: edit, fork, disable, or ignore
any of them. Authored by us, not vendored from any third party.

Each file is a self-contained bundle of canonical wire records that validate against
`docs/FLOW-V0-SPEC.md` §1:

```jsonc
{
  "flow":  { /* one knowtation.flow/v0 record */ },
  "steps": [ /* its ordered knowtation.flow_step/v0 records */ ]
}
```

The Knowtation index is the source of truth once the store lands (steps 7A-5..7A-10); these files are
the canonical **seed definitions** that ride `feat/flow-v0-spec` and load with the first code slice.
A `vault_mirror_path` is declared per Flow for the optional Markdown mirror (spec §2.2) — derived from
the index, never the reverse.

## Shared defaults (spec §7)

- **Scope** `personal` unless the Flow is a project process (the two process Flows are `project`).
- **External / automatable effects off.** Steps are `manual` or `agent_assisted`; no `automatable`
  step runs in v0 (execution gate 7A-L3).
- **Verification kinds** are `human_review` and `artifact_exists` only (others are runtime-gated).
- **Every durable write routes through review** (`knowtation propose` / the review tray) — no new
  write path; no record writes canonical knowledge directly.
- **No secrets.** `requires` and `skill_refs` carry handles/opaque ids only; step text is untrusted
  input, never a trusted command, and cannot widen scope from inside a Flow.

## The starter set

| File | Flow | Scope | Group |
| --- | --- | --- | --- |
| `flow_capture_to_note.json` | Capture → reviewed note | personal | Knowledge & capture |
| `flow_research_brief.json` | Source-grounded research brief | personal | Learning loop |
| `flow_reviewed_writeback.json` | Note → reviewed write-back | personal | Authoring, review & workspace |
| `flow_session_to_flow.json` | Session-to-Flow review | personal | Agent operations |
| `flow_multi_repo_change.json` | Multi-repo substrate + top-layer change | project | Process (dogfood) |
| `flow_overseer_handover.json` | Overseer handover | project | Process (dogfood) |

The two `project`-scoped process Flows dogfood the cross-repo coordination playbook
(`scooling/docs/CROSS-REPO-COORDINATION.md`): the multi-repo change procedure and the docs-first
overseer handover.
