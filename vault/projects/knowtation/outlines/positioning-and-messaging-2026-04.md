---
title: Positioning and messaging — Knowtation (April 2026)
date: 2026-04-30
project: knowtation
tags: [strategy, positioning, messaging, knowtation, gtm]
revision: 1
editor: marketing-strategy
last_review: 2026-04-30
depends_on:
  - projects/knowtation/style-guide/voice-and-boundaries.md
  - projects/knowtation/research/public-sources-2026.md
  - projects/born-free/style-guide/voice-and-boundaries.md
  - projects/store-free/style-guide/voice-and-boundaries.md
---

# Positioning and messaging — Knowtation — 2026-04

## Changelog

- **2026-04-30** — Outline created **parallel to Born Free and Store Free** outlines so the OpenClaw + Content Machine conveyor belt has a consistent project shape across all three launches. Voice depends on `projects/knowtation/style-guide/voice-and-boundaries.md`. Public URLs and social handles come from `projects/knowtation/research/public-sources-2026.md` only — agents must not invent URLs.

## Situation (from research)

- **Category framing:** Knowtation is **`know + notation`** — a personal / team knowledge and content system that captures, indexes, and finds notes and media, with a CLI and optional agents that stay in sync with the user's source material. It is *not* a "second brain that knows you better than you do" and not an autonomous publisher.
- **Two paths the marketing must serve in parallel:**
  1. **Self-hosted (Track L):** developer-friendly users who want their vault on disk, the CLI, and stdio MCP into Cursor / OpenClaw / Claude Desktop.
  2. **Hosted (Track H):** browser users on `https://knowtation.store/hub/` who want teammates, a tenant vault behind the gateway, and the same skill packs available without running a local server.
- **Dogfooding:** Knowtation is the brain that drives Born Free and Store Free marketing flows in this same playbook (see `docs/marketing-internal/AGENT-MARKETING-STRUCTURE.md`). Marketing copy can show Knowtation **running its own GTM** as a credibility proof — but only with paths and screenshots that exist in the live product.
- **Evidence discipline:** Every public number, claim, or feature line must trace to either the public whitepaper (`docs/WHITEPAPER.md` v3.3 on `main`), the `README.md`, the `SPEC.md`, or the public-sources registry in `projects/knowtation/research/public-sources-2026.md`. Anything not anchored there is **[NEEDS CONFIRMATION]** until sourced.

## Strategic choices

1. **Primary ICP (umbrella).** People and small teams who already keep notes (Markdown, Obsidian, Notion exports, voice memos) and are tired of either (a) bloated all-in-one tools that hide their content behind a vendor, or (b) ad-hoc `grep` + folder soup that loses context. We meet them where they are: **vault on disk OR vault in the hosted Hub** — same skills, same MCP, no second secret copy.
2. **Category frame.** Knowledge + content system, not a chat assistant. We index Markdown, retrieve with provenance (vault paths + frontmatter), and let agents read and write the same files a human edits — no opaque memory store. **Position as durable, searchable, agent-ready notes** — not as a generic AI wrapper.
3. **Proof we will lead with.** Restrict to shipped surfaces and documented behavior — for example: open-source MIT repo (`aaronrene/knowtation`), CLI commands (`knowtation search | get-note | write | index`), MCP server with tool descriptors (`mcp/server.mjs`, `docs/AGENT-ORCHESTRATION.md`), Hub REST API (`docs/HUB-API.md`), proposal flow with optional review hints / Enrich, and the integrations block in **Settings → Integrations → Hub API**. Do not promise SLAs, recall accuracy numbers, or "used by N teams" until we have a verifiable source.

### Triggers (why now)

| Trigger | Anchor |
|---------|--------|
| Frustration with "summarize my whole drive" black-box tools that lose provenance | `projects/knowtation/style-guide/voice-and-boundaries.md` §1 (audience) |
| Cursor / Claude / OpenClaw users who want one MCP that reads + writes a real Markdown vault | `docs/AGENT-INTEGRATION.md`, `docs/AGENT-ORCHESTRATION.md` |
| Teams who want an open-source, MIT-licensed knowledge base they can self-host (Track L) | `README.md`, `LICENSE`, `docs/SPEC.md` |
| Hosted users who want a browser Hub with teammates + JWT-authed agents | `https://knowtation.store/hub/`, `docs/AGENT-INTEGRATION.md` §2–3 |
| Operators tired of juggling OpenAI + Anthropic + Voyage + ElevenLabs API keys | DeepInfra single-provider routing in `lib/llm-complete.mjs` (2026-04-30) |

### Objections (internal scripts)

| Objection | Answer anchor |
|-----------|----------------|
| "Isn't this just Obsidian / Notion / Mem with extra steps?" | We are Markdown-on-disk *or* hosted, with first-class CLI + MCP for agents — your notes are the source of truth, not a vendor's database. Voice §3 (no hype). |
| "Will the agent silently auto-publish or auto-export?" | No. Writes go to `drafts/` or via proposals; the human approves before `published/`. Voice §3 ("no autonomous publishing"); style-guide §7 (AI disclosure) and §8 review checklist. |
| "What about my data?" | Self-hosted: bytes never leave your machine. Hosted: tenant-isolated canister + JWT-authed Hub. We do not promise GDPR / HIPAA outcomes — see `style-guide/voice-and-boundaries.md` §5. |
| "Do I need to know the CLI to use it?" | No. Hosted users can stay in the browser Hub. Skill packs and MCP make the CLI optional even for power users. |
| "How much does it cost?" | Open-source self-hosted: free. Hosted: pricing per `https://knowtation.store` and Stripe — do not state numbers in copy until the page is shipped and verified. |
| "How does it compare to ChatGPT memory / Claude Projects?" | Those are conversation caches; Knowtation is a vault with provenance + tools. They can co-exist (Claude Project as session cache; vault as durable source of truth — see `docs/marketing-internal/AGENT-MARKETING-STRUCTURE.md` Phase A). Compare on **capabilities**, not dunks. |

## Canonical live URLs (Knowtation product)

From **`projects/knowtation/research/public-sources-2026.md`**:

| What | URL |
|------|-----|
| Marketing / landing | `https://knowtation.store` |
| Hub (signed-in web app) | `https://knowtation.store/hub/` |
| Discord | `https://discord.com/invite/NrtzhZtrED` |
| YouTube | `https://www.youtube.com/@Knowtation` |
| X (Twitter) | `https://x.com/Knowtation1111` |
| GitHub repo | `https://github.com/aaronrene/knowtation` |
| Whitepaper (rendered) | `https://github.com/aaronrene/knowtation/blob/main/docs/WHITEPAPER.md` |
| Whitepaper (raw, for agents) | `https://raw.githubusercontent.com/aaronrene/knowtation/main/docs/WHITEPAPER.md` |

**Last checked in registry:** 2026-04-29 (re-verify before major launch).

Confirm primary host before campaign: `https://knowtation.store` vs `https://www.knowtation.store` (registry note).

## For / Who / Unlike / We (skeleton)

| Block | Draft |
|-------|-------|
| **For** | People and small teams who keep notes in Markdown (or want to) and want their notes to be searchable, agent-readable, and exportable — without surrendering provenance to a vendor's database. |
| **Who** | Are tired of opaque "all-knowing" assistants, lossy folder grep, and tools that publish on their behalf without a clear audit trail. |
| **Our product** | Knowtation — Markdown vault + CLI + MCP + optional hosted Hub. Same skill packs work whether your notes live on disk or in a tenant canister. Open source (MIT). |
| **Unlike** | Black-box memory tools, generic chat wrappers, and "second brain" products that quietly mirror your content into a vendor cloud — we describe what gets stored, where, and what the agent is allowed to do. Compare on capabilities, not trash talk (style-guide §3, §5). |
| **We** | Verifiable behavior: every search returns vault paths, every write is auditable, every proposal has a human approval step. The CLI is the same one the Hub runs. The MCP server is open source. |

## Message hierarchy

**External headline rule:** Lead with **durable, searchable, agent-ready notes** — and the choice between self-hosted on disk or hosted in the browser. Do not lead with "AI" as the differentiator; AI is a feature on top of the vault, not the product.

- **Pillar 1** — Your notes stay yours.
  Markdown on disk (self-hosted) or in your tenant canister (hosted) — never silently mirrored to a vendor's training set. Provenance is a vault path, not a vector ID.
  **Proof:** `docs/SPEC.md` §4 (vault layout); `docs/HUB-API.md` (tenant isolation); `docs/AGENT-INTEGRATION.md` (JWT + `X-Vault-Id`).

- **Pillar 2** — Two paths, one workflow.
  Track L (self-hosted, `KNOWTATION_VAULT_PATH` + stdio MCP + `npm run hub`) and Track H (hosted Hub at `https://knowtation.store/hub/` + REST + hosted MCP) share the same skill packs, frontmatter, and proposals. Switching paths does not invalidate your skill packs or imports.
  **Proof:** `docs/marketing-internal/AGENT-MARKETING-STRUCTURE.md` §2.3–2.4 (Tracks L and H, side-by-side mappings); `docs/TWO-PATHS-HOSTED-AND-SELF-HOSTED.md`.

- **Pillar 3** — Agent-ready, not agent-controlled.
  MCP `search`, `get_note`, `list_notes`, `write` (or `propose`); skill packs in `.cursor/skills/packs/`; tiered retrieval that minimizes token cost; proposal flow that gates writes. Agents draft into `drafts/`; humans approve into `published/`.
  **Proof:** `mcp/server.mjs`, `docs/AGENT-ORCHESTRATION.md`, `docs/RETRIEVAL-AND-CLI-REFERENCE.md`, `docs/HUB-PROPOSAL-LLM-FEATURES.md`.

- **Pillar 4** — Open source where it counts.
  Repo, CLI, MCP server, Hub REST contract, and the canister source are MIT — you can audit the read/write paths. Hosted is the convenient default; self-hosted is the escape hatch.
  **Proof:** `LICENSE`, `https://github.com/aaronrene/knowtation`, `docs/SPEC.md`, `docs/HUB-API.md`.

- **Pillar 5** — One LLM bill (optional).
  Hosted Hub chat + embeddings can run on a single OpenAI-compatible key (DeepInfra) — same key OpenClaw uses for orchestration. Operators can also keep OpenAI / Anthropic / Voyage as fallback or primary; the choice is documented in `lib/llm-complete.mjs` and `.env.example`.
  **Proof:** `docs/HUB-PROPOSAL-LLM-FEATURES.md` "Chat provider selection" section; `lib/llm-complete.mjs` provider order; `.env.example` chat + embedding lanes.

## Sibling products (short pointers — do not duplicate full positioning)

| Sibling | Role in umbrella copy | Where full positioning |
|---------|------------------------|------------------------|
| **Born Free** | Member-managed property network, Experience Keys, governance. Different ICP from Knowtation — only mention in cross-product copy. | `projects/born-free/outlines/positioning-and-messaging-2026-04.md`; voice: `projects/born-free/style-guide/voice-and-boundaries.md`. |
| **Store Free** | Documents, signing, custody under the Born Free family — instructional, limits-forward voice. Cross-product mention only. | `projects/store-free/outlines/positioning-and-messaging-2026-04.md`; voice: `projects/store-free/style-guide/voice-and-boundaries.md`. |

## Forbidden claims

- Do **not** promise infallible recall, "knows you better than you do", or fully autonomous publishing.
- Do **not** invent benchmarks, "95% faster", "used by N teams", or testimonials we cannot verify (style-guide §5).
- Do **not** state SLAs or compliance certifications (GDPR, HIPAA, SOC 2, etc.) until product / legal signs off in writing.
- Do **not** trash other tools (Obsidian, Notion, Mem, ChatGPT memory, Claude Projects). Compare on capabilities and tradeoffs only (style-guide §5).
- **Urgency:** only real release dates, real billing dates, real deprecations — never fake "your vault will be deleted" threats (style-guide §6).
- **AI disclosure:** if a piece of public copy is substantively AI-drafted, disclose per channel rules (style-guide §7).

## Open conflicts

- **Pricing pages:** none documented yet. When the hosted pricing page ships at `https://knowtation.store`, link from this outline and add to `projects/knowtation/research/public-sources-2026.md`.
- **Hosted vs self-hosted feature parity:** track per-feature in `docs/TWO-PATHS-HOSTED-AND-SELF-HOSTED.md`. Marketing copy must not promise feature parity that engineering has not landed.

## Related

- Sibling outlines (umbrella + tool tracks): `projects/born-free/outlines/positioning-and-messaging-2026-04.md`, `projects/store-free/outlines/positioning-and-messaging-2026-04.md`.
- Voice guide: `projects/knowtation/style-guide/voice-and-boundaries.md`.
- URL + repo registry: `projects/knowtation/research/public-sources-2026.md`.
- Internal agent / GTM playbook: `docs/marketing-internal/AGENT-MARKETING-STRUCTURE.md`.
- LLM provider routing decision (driving Pillar 5): `docs/NEXT-SESSION-HUB-LLM-COST-ROUTING.md`.
