---
name: print-next
description: >-
  Print the current paste-ready NEXT fence from disk after updating living
  handover/roadmap. Use ok next (or Read the handover) — never paste from
  memory or an open tab. Required on every closeout that touches those docs.
---

# Print NEXT (closeout)

After **any** update to the living handover and/or roadmap, the agent’s **FINAL reply**
MUST include the full paste-ready fence under heading `## CURRENT NEXT — paste this`.
Bytes MUST come from read from disk after write (run `ok next`, or Read the
handover file and extract the `### Paste-ready prompt` fence). Do **not** paste from
memory, from an earlier chat, or from an unsaved editor buffer. Session incomplete without it.

Prefer native editor tools (Cursor StrReplace/Write; Claude Code Edit) for
handover/roadmap so the host is more likely to refresh an open tab. That preference is
best-effort and does **not** replace `ok next`. Host niceties do not guarantee an accurate open tab.

## Fast path

```bash
ok next
# synonym:
ok governance-sync --print-next
```

## Source of truth order

1. `ok next` / the printed CURRENT NEXT fence (this session, after the write)
2. The handover file on disk at the config-driven path
3. Never whatever the open tab happens to show

## Not this command

`ok workspace check-next` is constellation relay freshness (exit 35). Do **not** alias
it to `ok next`.
