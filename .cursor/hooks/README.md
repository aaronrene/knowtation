# Cursor session bookends (LT slice 2)

When `session_bookends.enabled: true` in `.overseer/config.yaml`, `ok sync` / `ok init`
vendors the full hook bundle into `.cursor/hooks/`:

| Destination | Source |
| --- | --- |
| `.cursor/hooks.json` | `cursor/hooks/hooks.json` |
| `.cursor/hooks/session-start-next.sh` | `cursor/hooks/session-start-next.sh` |
| `.cursor/hooks/session-end-closeout.sh` | `cursor/hooks/session-end-closeout.sh` |
| `.cursor/hooks/README.md` | `cursor/hooks/README.md` |

**Default:** `session_bookends.enabled: false` — hooks are **not** footprint members unless
the flag is on (ONS §LT.4.4 narrow supersession).

## Behavior (frozen §LT.4.5)

- `sessionStart` / `stop`: run `session-start-next.sh` → `ok next` body + workspace-root +
  stale-tab honesty (fail-open JSON).
- `sessionEnd`: run `session-end-closeout.sh` → `ok governance-sync --dry-run` then `ok next`
  (never `--write`; never claim tab reload).
- `failClosed`: always **false** — hooks never block DONE.

## Manual merge (existing `.cursor/hooks.json`)

If a consumer already has hooks, sync classifies like any footprint file (`missing` → seed;
`both-changed` → no clobber without `--force`). No JSON deep-merge in Auto v1.

`cursor/hooks/print-next-stop.json` remains the ONS snippet for hand-merge of **stop** only.

## Portable primary (unchanged)

| Action | Command |
| --- | --- |
| Print NEXT | `ok next` / `ok governance-sync --print-next` |
| Session-end hygiene | `ok governance-sync --dry-run` |
| Ad-hoc honesty | `ok check-ok` / `/check-ok` |

Missing Cursor hooks is **not** pass and **not** fail — degrade to CLI.
