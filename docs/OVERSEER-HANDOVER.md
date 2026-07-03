# Overseer Handover — Knowtation (Phase 8 P1b)

Status: **Living artifact — Knowtation cross-repo handover for Phase 8 P1b offline-locked auth.**

Scooling overseer handoff lives in `scooling/docs/OVERSEER-HANDOVER.md`. Update **both** when P1b
milestones land.

---

## Next step at a glance (2026-07-02)

| | |
| --- | --- |
| **2F-b-d-kn-a contract** | **DONE** — `docs/MEDIA-WRITE-SURFACES-CONTRACT-2F-b-d-kn.md` frozen |
| **2F-b-d-kn-b build** | **DONE** — canonical write surfaces implemented; **21/21** media-write tests green; Muse `sha256:3690634d…`; Git `4821663`; merged Muse `main` |
| **Posture** | Write routes **live in code** but **inert** — `MEDIA_EXTERNAL_LINK_ENABLED` / `MEDIA_ATTACH_ENABLED` default **off**; read-only attachments unchanged |
| **Branch** | Muse `main` merged (2026-07-02); GitHub muse-mirror PR pending (SD-14) |
| **Next (Knowtation)** | **2F-b-d-kn-c** — Tier 3 operator session: enable **`MEDIA_EXTERNAL_LINK_ENABLED` only** (§16.1 KE-*); **`MEDIA_ATTACH_ENABLED` unchanged** |
| **Next (Scooling)** | **2F-b-d-e** — flip `MEDIA_EXTERNAL_LINK_AUTHORIZED` only — **blocked until** Knowtation §16.1 passes; never bundled with 2F-b-d-f |

---

## Media write surfaces (2F-b-d-kn — Scooling 2F-b-d unblock)

| | |
| --- | --- |
| **2F-b-d-kn-a contract** | **DONE** (2026-07-02, Thinking) — `docs/MEDIA-WRITE-SURFACES-CONTRACT-2F-b-d-kn.md` |
| **2F-b-d-kn-b build** | **DONE** (2026-07-02, Auto) — SD-4 facades + stores + Hub/CLI/MCP/OpenAPI + seven-tier tests |
| **What landed (2F-b-d-kn-b)** | `lib/attachments/attachment-write.mjs`; `media-connector-policy.mjs`; `media-import-consent.mjs`; `attachment-external-ref-store.mjs`; `connector_ref` read join + `ATTACHMENT_ID_RE` `link` tag; approve dispatcher `MEDIA_PROPOSAL_SOURCE`; smoke `scripts/verify-media-write-smoke.mjs` |
| **Gates (default off)** | `MEDIA_EXTERNAL_LINK_ENABLED` · `MEDIA_ATTACH_ENABLED` — **independent, never bundled** |
| **Test command** | `node --test test/media-write-*.test.mjs` — **21/21 PASS** (gates off) |
| **Smoke (hosted)** | `node scripts/verify-media-write-smoke.mjs` — confirms gates refuse when off |
| **Scooling unblock** | **2F-b-d-e** / **2F-b-d-f** require matching Knowtation gate enablement (§16) **after** merge to `main` |

---

## Verified snapshot (2F-b-d-kn-b)

| Deliverable | Location |
| --- | --- |
| Write facade | `lib/attachments/attachment-write.mjs` — propose + `reconcileApprovedMediaProposal` |
| Connector allowlist | `lib/attachments/media-connector-policy.mjs` → `hub_media_connector_policy.json` |
| Import consent | `lib/attachments/media-import-consent.mjs` → `hub_media_import_consent.json` |
| External refs | `lib/attachments/attachment-external-ref-store.mjs` → `hub_attachment_external_refs.json` |
| Read join | `lib/attachments/attachment-store.mjs` — fourth source `connector_ref`; `ATTACHMENT_ID_RE` includes `link` |
| Hub REST | `POST …/link-proposals`, `POST …/attach-proposals`, import-consent CRUD in `hub/server.mjs` |
| Approve path | `precheckApprovedMediaProposal` + `reconcileApprovedMediaProposal` in approve handler |
| CLI | `knowtation attachment link-propose \| attach-propose \| import-consent grant\|list\|revoke` |
| MCP | `media_external_link_propose`, `media_attach_propose`, `media_import_consent_list` (consent grant **not** MCP write) |
| OpenAPI | `docs/openapi.yaml` — `MediaProposalResponse` + routes |
| Tests | `test/media-write-*.test.mjs` — **21/21**; SSRF tier: **zero outbound fetch** |
| Smoke | `scripts/verify-media-write-smoke.mjs` |

**Verification gate:**

```bash
node --test test/media-write-*.test.mjs
node scripts/verify-media-write-smoke.mjs   # self-hosted Hub; gates off → 403 expected
```

---

## Verified snapshot (2F-b-b read — unchanged)

| Deliverable | Location |
| --- | --- |
| Read store | `lib/attachments/attachment-store.mjs` |
| Hub REST | `GET /api/v1/attachments`, `GET /api/v1/attachments/:id` |
| Tests | `test/attachment-store-*.test.mjs` — **28/28 PASS** |

---

## Attachment gates (Scooling Phase 2F-b)

| | |
| --- | --- |
| **2F-b-b** | **DONE + MERGED** — read-only list/get; Muse `main` @ `sha256:a602cc7…`; GitHub [PR #256](https://github.com/aaronrene/knowtation/pull/256) |
| **Consumer** | Scooling `MEDIA_LIVE_READ_AUTHORIZED` **live**; external link + attach consumer gates **hard-false** |

---

## Change log

| Date | Event |
| --- | --- |
| 2026-07-02 | **2F-b-d-kn-b MERGED** — canonical media write surfaces build; 21/21 media-write tests; gates default off; Muse `sha256:3690634d…`; Git `4821663`; Muse `main` merged; GitHub muse-mirror PR pending; next = **2F-b-d-kn-c** (external link gate only, §16.1) |
| 2026-07-02 | **2F-b-d-kn-b DONE** — build on feature branch; Muse `sha256:db5adf05…`; Git `4cf5480` |
| 2026-07-02 | **2F-b-d-kn-a contract FROZEN** — `docs/MEDIA-WRITE-SURFACES-CONTRACT-2F-b-d-kn.md`; Muse `sha256:c4ab1e50…` |
| 2026-07-02 | **2F-b-b MERGED** — read-only attachments; GitHub [PR #256](https://github.com/aaronrene/knowtation/pull/256) |
| 2026-07-01 | P1b-c **MERGED** — offline locked auth shipped |

---

## Next-chat prompt — PRIMARY — 2F-b-d-kn-c external link gate · Model: **Auto (Tier 3 operator)**

```text
OVERSEER HANDOVER — 2026-07-02 (Knowtation 2F-b-d-kn-c — external link gate enablement)

Cursor model: Auto (Tier 3 operator session)

You are the operator/build agent for Knowtation Phase 2F-b-d-kn-c — enable
MEDIA_EXTERNAL_LINK_ENABLED ONLY. Read knowtation/docs/MEDIA-WRITE-SURFACES-CONTRACT-2F-b-d-kn.md
§16.1 (KE-1..KE-12) in full before acting.

Verified standing (post 2F-b-d-kn-b merge):
- Knowtation 2F-b-d-kn-b DONE — write surfaces on Muse main @ sha256:3690634d…; Git 4821663; 21/21 media-write tests (gates off)
- MEDIA_EXTERNAL_LINK_ENABLED and MEDIA_ATTACH_ENABLED default OFF in production posture
- Scooling 2F-b-d-b DONE — consumer wire ready; MEDIA_EXTERNAL_LINK_AUTHORIZED hard-false

Branch: feat/phase-2f-b-d-kn-c-external-link-gate (off Muse main) OR operator dev/staging env only

THE ONE NEXT STEP — Enable external link gate ONLY (never bundle attach):

1) GitHub muse-mirror PR for 2F-b-d-kn-b merge if not done (SD-14)
2) In dev/staging ONLY: set MEDIA_EXTERNAL_LINK_ENABLED=1 (env or hub_media_write_policy.json)
3) Seed connector allowlist (hub_media_connector_policy.json) for test vault — admin only
4) Re-run seven tiers with link gate ON, attach gate OFF:
   node --test test/media-write-*.test.mjs
5) Run §16.1 checklist KE-1..KE-12; record authorization block in contract §16
6) scripts/verify-media-write-smoke.mjs — link path proposes (attach still 403 MEDIA_ATTACH_DISABLED)
7) Update knowtation/docs/OVERSEER-HANDOVER.md + scooling/docs/ROADMAP.md + OVERSEER-HANDOVER.md
8) Unblocks Scooling **2F-b-d-e** (separate session — flip MEDIA_EXTERNAL_LINK_AUTHORIZED only)

Hard stops:
- MEDIA_ATTACH_ENABLED MUST remain OFF this session (KN-MD-4)
- Do NOT flip Scooling MEDIA_EXTERNAL_LINK_AUTHORIZED in this session (canonical-first: KN gate then SC)
- No server-side fetch of opaque_ref (§10)
- One gate per Tier 3 session

When done: report KE checklist, test counts with gate on, confirm attach gate untouched.
```
