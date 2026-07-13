# Issue draft — `muse clone` stuck on `fetch/mpack` “server busy” (pack never ready)

**Target repo:** `gabriel/muse` (and/or MuseHub staging ops)  
**Reporter:** aaronrene  
**Date:** 2026-07-13  
**Client:** `muse 0.2.0.dev4` (installed via `https://staging.musehub.ai/install.sh`)  
**Hub:** `https://staging.musehub.ai`

## Summary

Cold `muse clone` against staging never completes. Auth, hub ping, and `muse ls-remote` succeed. The clone loop repeatedly POSTs `/{owner}/{slug}/fetch/mpack` with `have=0` and prints “remote preparing fetch data (server busy)” until `--retry-timeout` expires. No objects are written locally.

This blocks collaborators who need a fresh Muse checkout of large or any repo on this machine (reproduced on both `aaronrene/knowtation` and `gabriel/muse`).

## What works

| Check | Result |
| --- | --- |
| `muse auth whoami` | Handle `aaronrene`, hub `staging.musehub.ai` |
| `muse hub ping --hub https://staging.musehub.ai` | HTTP 200 |
| `muse ls-remote https://staging.musehub.ai/aaronrene/knowtation` | Returns `main` + other branch tips |
| `muse clone --dry-run …` | Succeeds (no network pack assembly) |

## What fails

```text
muse clone --depth 1 --branch main --retry-timeout 300 \
  https://staging.musehub.ai/aaronrene/knowtation ~/knowtation-muse
```

Observed (representative):

```text
[transport] POST https://staging.musehub.ai/aaronrene/knowtation/fetch/mpack  want=2 have=0
⏳ remote preparing fetch data (server busy, attempt N); retrying in 30s …
…
❌ Remote still preparing clone data after 300s — try again shortly.
```

Same pattern for:

```text
muse clone --depth 1 --branch main --retry-timeout 90 \
  https://staging.musehub.ai/gabriel/muse /tmp/muse-tiny-clone
```

(`want=3 have=0`, same busy loop.)

Also reproduced earlier with `--retry-timeout 1200` (20 minutes) on `aaronrene/knowtation` — never recovered.

## Client transport note (likely related)

Installed client transport (`…/site-packages/muse/core/transport.py`):

- Uses **`fetch/mpack` only** (`fetch/presign` string **absent**).
- Staging MuseHub tree for `gabriel/muse` recently shows a commit titled approximately:  
  **“fix: try fetch/presign before fetch/mpack to avoid Cloudflare…”**  
  That fix does **not** appear in the `0.2.0.dev4` sdist from `install.sh`.

Hypothesis A: hub pack assembly / indexing for cold `have=0` fetches is stuck or never finishes (503 + Retry-After forever).  
Hypothesis B: client should fall back to `fetch/presign` (per-object GETs) but shipped staging CLI never tries that path, so clones die on mpack prep / Cloudflare limits.

## Expected

`muse clone` of a public or authorized repo completes within a normal budget (or returns a hard, actionable error with request id), and writes a usable `.muse/` with objects.

## Ask

1. Confirm whether staging `fetch/mpack` pack prep is healthy for cold clones (`have=[]`).
2. Publish a staging CLI that includes **presign-before-mpack** (or document how to force `fetch/presign`).
3. If this is known 503-while-indexing: surface a terminal error / request id after N retries instead of an indefinite “busy” loop.

## Non-goals / not the cause

- Not an auth/handle problem (ls-remote + ping work).
- Not missing mnemonic / wrong machine password.
- Not specific to one private repo (fails on `gabriel/muse` too).

## Workarounds for operators (until fixed)

- Copy an existing `.muse/` (or full Muse checkout) from a machine that already has objects.
- Do not hammer clone (rate limits / Cloudflare 429 on unauthenticated probes).
