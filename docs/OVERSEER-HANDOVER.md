# Overseer Handover — Knowtation

**Cross-repo note:** The **authoritative** next-step board is **Scooling**
`docs/OVERSEER-HANDOVER.md` and `docs/ROADMAP.md` (Current Status Snapshot).
Do **not** treat this file as a second roadmap.

Knowtation-only notes that are safe to keep public live below. Internal freeze docs /
ops evidence live under local **`development/`** (gitignored) — see `docs/README.md`.

---

## Status (Knowtation product)

| | |
| --- | --- |
| **API** | `api.knowtation.store` live |
| **MCP public** | `https://mcp.knowtation.store/mcp` |
| **Durable agent auth** | MCP OAuth durable refresh + Hub **Connect cloud agent** (RFC 8628) shipped on `main` ([KN #271](https://github.com/aaronrene/knowtation/pull/271)). Public recipes: [`AGENT-INTEGRATION.md`](./AGENT-INTEGRATION.md) § Always-on cloud agents. Device routes require the **persistent MCP gateway** deploy. |
| **Calendar 1D** | LIVE (gate on) |

---

## Change log (recent)

| Date | Event |
| --- | --- |
| 2026-07-13 | Docs hygiene: durable-auth freeze/evidence moved to local `development/` (not public). Overseer authority = Scooling. |
| 2026-07-13 | Connect cloud agent + honesty UI merged — [KN #271](https://github.com/aaronrene/knowtation/pull/271) |
| 2026-07-12 | Durable MCP OAuth refresh (strong store) merged — [KN #270](https://github.com/aaronrene/knowtation/pull/270) |
