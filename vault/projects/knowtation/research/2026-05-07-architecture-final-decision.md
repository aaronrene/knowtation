---
title: Architecture final decision — Knowtation/Muse + Paperclip + OpenClaw (2026-05-07)
date: 2026-05-07
project: knowtation
tags: [architecture, decision, paperclip, openclaw, musehub, muse, video-factory, sovereignty, governance]
revision: 1
last_review: 2026-05-07
editor: aaronrene
challenged_count: 4
status: locked
depends_on:
  - docs/marketing-internal/RUNBOOK-VIDEO-FACTORY-2026-04-30.md
  - deploy/paperclip/README.md
  - deploy/paperclip/agents/_universal-preamble.yaml
  - vault/projects/knowtation/outlines/openclaw-byoa-addendum-2026-05-07.md
  - AGENTS.md
---

# Architecture final decision — 2026-05-07

> **⚠️ INFRA UPDATE (owner-confirmed 2026-06-06):** the **AWS EC2 Paperclip box has been
> decommissioned**; Paperclip now runs on the **iMac**. Every statement below that the AWS box is
> "already deployed / provisioned and running in us-east-2" (e.g. §"Plain-language summary",
> §"Technical summary", §"Verified status as of 2026-05-07" table) reflects the **2026-05-07** state
> and is now **historical**. The four-layer architecture decision itself stands; only the hosting
> location of the org-chart/worker layer changed (AWS → iMac).

> **Status:** locked. Per Rule #3, this decision was challenged 4+ times during a single chat session before locking. Per Rule #1, this is a permanent decision, not a temporary fix. Counter-arguments are recorded under "Alternatives considered." If this reads wrong to a future you, file a counter-note under `vault/projects/knowtation/research/` and revisit explicitly — do not improvise around this doc.

## Plain-language summary (the contract)

Knowtation is a **four-layer stack**, where each layer has one job and is independently swappable:

1. **Substrate (sovereign storage + provenance)** — Knowtation vault + MuseHub `knowtation` domain plugin (in development) + Muse `identity` and `mist` domains (live on staging.musehub.ai). HMAC + Ed25519 + ICP attestation + identity-chain + org-quorum signing. This is the layer that survives every other change.
2. **Provider gateway (model-agnostic completion)** — `lib/llm-complete.mjs` and `lib/embedding.mjs`. Multi-provider routing with automatic fallback. No agent or skill imports a model SDK directly.
3. **Org-chart layer (governance, budgets, audit)** — Paperclip on AWS (already deployed). Hires workers, tracks tickets, enforces budgets, exposes a dashboard, isolates companies.
4. **Worker layer (agent runtimes that do the actual jobs)** — today: native Paperclip YAML agents (6 role templates × 3 project configs + 1 controller). Later: OpenClaw bots hired under Paperclip's BYOA contract whenever a use case needs channels (Slack, WhatsApp, iMessage, Discord, Email) or pre-built integrations (Gmail, Calendar, Notion, Linear, GitHub).

**Why this shape:** Aaron will have many agents soon — across Born Free, Store Free, Knowtation, and future ventures. Multi-business, multi-team, governance-required. Paperclip is the right org-chart layer for this scale. OpenClaw is the right worker runtime for any agent that needs to live where humans already are. Muse-backed Knowtation is the right substrate for the agentic-commerce future where cryptographic identity and signed transactions matter.

**Plain consequence:** keep everything that was already built; finish the video factory smoke test on Paperclip; build the MuseHub Knowtation domain plugin in parallel; defer the OpenClaw BYOA adapter until the first concrete channel use case arrives.

## Technical summary

- **Substrate**: Knowtation vault (Markdown + frontmatter) + Knowtation hosted Hub (REST + MCP) + MuseHub `knowtation` domain plugin (Phases 1-7 per the issue at `staging.musehub.ai/gabriel/muse/issues/2`). Cryptographic chain: commit Ed25519 → identity record → SPAWNS edge to parent → root identity → ICP anchor, with HMAC-attested commit metadata layered on, plus `mist` for binary attachments and org-quorum signing for org-handle commits.
- **Gateway**: `lib/llm-complete.mjs` + `lib/embedding.mjs` with `KNOWTATION_CHAT_PROVIDER=deepinfra` (Qwen 2.5-72B-Instruct) primary and `OPENAI_API_KEY` silent fallback. Future: add `tier` parameter for `cheap` (Cerebras Gemma 4 / Ollama) | `standard` (Qwen 2.5-72B) | `premium-judgment` (Anthropic Claude API / OpenAI GPT-5).
- **Org chart**: Paperclip (`github.com/paperclipai/paperclip`, MIT) on EC2 t3.medium in `us-east-2`, behind Tailscale, secrets in AWS SSM Parameter Store at `/knowtation/paperclip/*`, hot-reloaded every 60s via `paperclip-secrets-sync.timer`. Three "companies" in one install: `bornfree`, `storefree`, `knowtation`.
- **Workers (today)**: native Paperclip YAML agents at `deploy/paperclip/agents/_templates/*.yaml` (6 role templates), per-project configs at `deploy/paperclip/agents/<project>/project.yaml`, and a deterministic controller at `deploy/paperclip/agents/controller/controller.yaml`. Universal voice/claims gate at `deploy/paperclip/agents/_universal-preamble.yaml`. Skills at `deploy/paperclip/skills/*.mjs`.
- **Workers (later)**: OpenClaw bots hired via a `paperclip-plugin-openclaw` BYOA adapter, modeled on the reference `paperclip-plugin-acp` (Claude Code / Codex / Gemini CLI). See `vault/projects/knowtation/outlines/openclaw-byoa-addendum-2026-05-07.md` for the addendum.
- **VCS commitment**: per `AGENTS.md`, default tree commits go through Muse to MuseHub staging (`staging.musehub.ai`); Git is reserved for GitHub-only operations (PRs, CI, mirrors). Dogfooding Muse on MuseHub from this point forward.

## Verified status as of 2026-05-07

Per Rule #2, all of the following are facts checked against the actual repo state, not assumptions:

| Component | Status | Verification |
|---|---|---|
| AWS EC2 box for Paperclip | Provisioned and running in `us-east-2` | `deploy/paperclip/terraform/terraform.tfstate` shows real instance ID + Tailscale outputs |
| Paperclip Terraform | Applied (serial 14) | Same state file |
| Paperclip role templates | 6 files (script-writer, social-poster, clip-factory, blog-seo, newsletter, thumbnail-brief) | `deploy/paperclip/agents/_templates/*.yaml` |
| Paperclip per-project configs | 3 files (born-free, store-free, knowtation) | `deploy/paperclip/agents/<project>/project.yaml` |
| Paperclip controller | 1 deterministic pipeline file | `deploy/paperclip/agents/controller/controller.yaml` |
| Paperclip universal preamble | Live and enforced | `deploy/paperclip/agents/_universal-preamble.yaml` |
| Paperclip skills | 9 modules (5 Knowtation reads/writes + hub-client + 3 SaaS bridges) | `deploy/paperclip/skills/*.mjs` |
| Paperclip tests | 2 files (skills, bridges) | `test/paperclip-*.test.mjs` |
| MuseHub `knowtation` domain plugin | Not started (planned, not coded) | No `muse/plugins/knowtation/` directory exists in MuseHub repo |
| MuseHub `mist` domain | Live on staging | Confirmed in plan; `staging.musehub.ai/@gabriel/mist` |
| MuseHub `identity` domain | Live on staging | Confirmed in plan; `staging.musehub.ai/@gabriel/identity` |
| Provider gateway | Live, multi-provider | `lib/llm-complete.mjs` + tests at `test/llm-complete-deepinfra.test.mjs` |
| Hands-on SaaS signups (DeepInfra, HeyGen, ElevenLabs, Descript) | Pending | Per RUNBOOK-VIDEO-FACTORY-2026-04-30.md Steps 1-6 |
| Paperclip box: install.sh + push-secrets + smoke test | Pending | Per RUNBOOK Steps 8-9 |

**Practical state:** ~85-90% complete on the video factory. The remaining work is the user's hands-on signups + a smoke test run.

## Decision (locked)

1. **KEEP Paperclip** as the org-chart / governance / budgets / audit / multi-company layer. Already deployed. Already tested. Already correct shape for the multi-business future.
2. **KEEP all 11 Paperclip YAML files and 9 skill modules.** They are clean, templated (DRY), and tested. They are the right primary worker pattern for batch server-side jobs (the video factory).
3. **DEFER the OpenClaw BYOA adapter** until the first concrete channel use case arrives. Adapter cost is a one-time ~1-2 weeks of TypeScript work; subsequent OpenClaw bots are configuration-only after that. Build it when needed, not before.
4. **PROCEED with the MuseHub Knowtation domain plugin (Phases 1-7)** in parallel with Paperclip operations. The two streams are independent. See "Parallel safety" below.
5. **DOGFOOD Muse on MuseHub** for all repo work going forward, per `AGENTS.md`. Default `muse code add … && muse commit -m "…" && muse push staging <branch>` over Git. Git is reserved for GitHub-only operations (PRs, CI mirrors).
6. **WIRE provenance into `write-draft.mjs`** once Muse Phase 4 ships (`muse commit --meta --agent-id --model-id --event-type --sign --attest`). One-file change, ~30 lines, gives every draft a cryptographic identity chain.

## Sequencing (locked)

| Phase | What | Dependency | Approx duration |
|---|---|---|---|
| **Now → ~1 week** | Hands-on SaaS signups (DeepInfra, HeyGen Creator, ElevenLabs Creator, Descript). Record HeyGen Digital Twin (2 min), ElevenLabs Pro Voice Clone (30 min). Wait for clones to train (~4-8h each). | None | ~5 hrs of Aaron's hands |
| **+1 week** | SSH into Paperclip box, run `install.sh`, push secrets via `push-secrets.sh`, run `hello-world-test.sh`, run `wire-knowtation-mcp.sh`, run `load-skills-and-agents.sh`. First parallel run via `run-controller.sh`. Approve drafts in Hub UI. Manual upload to YouTube/X/IG/Beehiiv. | SaaS signups + voice/twin training complete | ~2 hrs |
| **+1 week → +10 weeks** | MuseHub `knowtation` domain plugin Phases 1-5 (foundation, structured merge, code-intel-over-notes, memory timeline, MCP surface). Track in MuseHub itself. Use Muse for VCS. | None | ~6-10 weeks (per the plan's OBA/Sonnet split) |
| **+10 weeks → +16 weeks** | MuseHub Phases 6-7 (UI + attestation + org-quorum). Wire `write-draft.mjs` to `muse commit` once Phase 4 is past. | Phase 5 complete | ~4-6 weeks |
| **First channel trigger** (whenever, likely +12-24 weeks) | Build `paperclip-plugin-openclaw` BYOA adapter. Hire first OpenClaw bot under Paperclip. Turn on first channel adapter (Slack or WhatsApp, depending on first use case). | OpenClaw 4.x stable; Paperclip BYOA SDK studied | ~1-2 weeks first time, then config-only per additional bot |

## Parallel safety: can Muse work disrupt the video factory?

**No.** They live in different repos and different runtime layers:

- The video factory runs in the `knowtation` repo (`/Users/aaronrenecarvajal/knowtation`), specifically inside `deploy/paperclip/`, on the AWS box, talking to the hosted Knowtation Hub via REST/MCP.
- The MuseHub `knowtation` plugin lives in the `MUSE_HUB/musehub` repo (the Muse VCS engine). New code goes under `muse/plugins/knowtation/` (not yet created).
- The two only meet at one optional point — `write-draft.mjs` invoking `muse commit` after Phase 4 ships. That integration is opt-in via a flag and feature-gated; the existing draft-write path keeps working until you flip it.
- Muse plugin development happens locally in the MuseHub repo, with tests, before publishing the manifest to staging. Production Paperclip continues running unchanged during that work.

## Channels and adapters — explicit roadmap

Aaron has explicitly confirmed (2026-05-07) that the team intends to interact with agents via OpenClaw's channel adapters and integrations:

- **Conversational channels** (in priority order based on team needs): WhatsApp, Discord, email/SMTP, Slack, Telegram, iMessage, Signal.
- **Productivity integrations** (turned on as use cases emerge): Gmail, Google Calendar, Notion, Linear, Jira, GitHub, Trello.
- **Each is a config flag in OpenClaw** once the BYOA adapter is built. We do **not** plan to write custom adapters per channel. Reusing OpenClaw's pre-built ecosystem is an explicit design goal.

The OpenClaw BYOA adapter (Phase 8 in the addendum) is the gating item. Once that's in, channels become configuration.

## Alternatives considered (per Rule #3)

| Alternative | Why rejected |
|---|---|
| **OpenClaw alone, no Paperclip** | Considered and partially recommended earlier in the deliberation. Rejected because: (1) Paperclip's org-chart pattern is the right shape for the multi-business future Aaron is heading into (4-6 ventures × multiple agents each, 30+ agents within 12-18 months); (2) Paperclip is already deployed with all secrets, infra, and 11 YAML/9 skill files written and tested — discarding live infra violates Rule #1; (3) Aaron explicitly wants to learn agent-wrangling and governance, which Paperclip teaches better than OpenClaw alone. |
| **Paperclip alone, no OpenClaw, ever** | Rejected because: (1) future customer-facing AI surfaces need channels (WhatsApp/Slack/iMessage); (2) building 50+ pre-built integrations from scratch under Paperclip is months of work that OpenClaw provides for free; (3) Paperclip is BYOA-designed — refusing to use that capability defeats its purpose. |
| **Pivot to OpenClaw alone now** (intermediate proposal during deliberation) | Rejected because: (1) Paperclip is already deployed and runtime-paid (~$33/mo AWS) — discarding violates "no waste" discipline and ignores sunk-cost-aware reasoning; (2) Aaron's stated need for org chart and governance fits Paperclip's design and not OpenClaw's; (3) the simpler OpenClaw-alone shape is right for a 1-person solo dev, not a multi-business team. |
| **Build MuseHub plugin first, defer everything else** | Rejected because the video factory is ~1 week from running and Muse plugin work has zero overlap with Paperclip operations. Sequential blocking would waste 6-10 weeks of factory-not-running time for no architectural benefit. |
| **Skip MuseHub plugin, stay on plain Markdown vault** | Rejected because: (1) the agentic-commerce future requires cryptographic identity, signed transactions, and tamper-evident records; (2) Muse + identity + mist + ICP gives Aaron a stronger sovereignty position than any cloud AI memory product; (3) the plan was authored thoughtfully and the components (mist, identity) are already live. |

## Risks identified (per Rule #2 — flagged, not assumed away)

1. **OpenClaw BYOA adapter under Paperclip exists in concept** (paperclipai.net lists OpenClaw as a supported runtime; reference adapter `paperclip-plugin-acp` exists for Claude Code/Codex/Gemini) **but I haven't verified its production maturity at the OpenClaw-specific level.** The Phase 8 spike (per the addendum) is the only honest way to find out before committing.
2. **OpenClaw is shipping fast** (4.7 → 4.26 → 4.29 in April 2026 alone). Pin to a specific version when integrating; don't auto-track latest.
3. **OpenClaw's foundation governance is in transition** (Peter Steinberger blog 2026-02-14 announced the move). MIT license is the legal backstop, but the governance model isn't legally formed yet. Mitigation: pin a version and fork-readiness.
4. **Paperclip is smaller than OpenClaw** (~63K vs ~369K stars). Bus factor is real. Mitigation: BYOA design lets us move workers off Paperclip if the upstream stagnates; only the org-chart layer would need replacement.
5. **Muse is a young stack** (mist + identity domains are LIVE on staging but only as of weeks before this decision). The MuseHub plan accepts this risk in exchange for sovereignty. Mitigation: the substrate plan ships in 7 phases, each independently shippable; rollback at any phase boundary is possible.
6. **Foundation transition timeline** for OpenClaw: 6-12 months expected. Until legally formed, OpenAI sponsorship is the operative funding source. Watch for any drift toward OpenAI-provider defaults; mitigate with pinned config and provider-tier router.

## Security stance (per Rule #6 + Rule #0 tier 7)

The seven-tier test discipline applies to every PR per Rule #0; the security-tier specifics for this architecture are:

- **JWT scope hardening** (Hub-side): refuse `status: published` PUTs from any agent-scoped JWT. Server-side enforcement, not prompt-level.
- **SSM secret hygiene**: `/etc/paperclip/env` mode `0640 root:paperclip`. Verify after every `install.sh` run.
- **JWT TTL**: `KNOWTATION_HUB_JWT` default 24h. Acceptable blast radius. Hot-rotate via Hub UI on suspicion.
- **AWS IP and instance ID** (the box's public IP and `i-…` instance ID) appear in `deploy/paperclip/terraform/terraform.tfstate` which is currently NOT git-ignored. **Action:** add `terraform.tfstate*` to `.gitignore` and `.museignore` before any future commit. (This is a separate one-line follow-up; logged here so it's not lost.)
- **Per-claim provenance**: enforced today via `_universal-preamble.yaml` prompt rules. Will be enforced at runtime once Muse Phase 4 + Phase 7 ship (HMAC + Ed25519 + identity-chain). Both layers fail-closed.
- **Org-quorum signing** (Phase 7.7): N-of-M valid member signatures with recursive quorum soundness. Threat model includes partial-quorum forgery, signer collusion below threshold, replay across branches. OBA review required at PR time.

## Open follow-ups (logged here so we don't lose them)

These are NOT urgent. They are tracked here for the next clean-up pass:

1. Add `terraform.tfstate*` to `.gitignore` and `.museignore` (security; see "AWS IP and instance ID" above).
2. Implement the gateway tier router (`lib/llm-complete.mjs` `tier: 'cheap' | 'standard' | 'premium-judgment'`) — saves cost on triage steps; not blocking the launch.
3. Add `claims[]` provenance to the draft frontmatter schema in `write-draft.mjs`. Becomes redundant after Muse Phase 7 attestation chain ships, but gives provenance discipline in the interim.
4. Audit `/etc/paperclip/env` mode and ownership during the smoke-test run. Surface a self-check fail if drifted.

## Cross-references

- The OpenClaw BYOA addendum to the MuseHub plan: `vault/projects/knowtation/outlines/openclaw-byoa-addendum-2026-05-07.md`
- The video factory runbook: `docs/marketing-internal/RUNBOOK-VIDEO-FACTORY-2026-04-30.md` (now annotated with this decision at the bottom)
- Superseded earlier prompts: `docs/marketing-internal/openclaw-content-machine-prompts.md` (kept for audit; deprecation banner added)
- Existing positioning that informed the brand voice: `vault/projects/knowtation/outlines/positioning-and-messaging-2026-04.md`
- Existing public-sources registry: `vault/projects/knowtation/research/public-sources-2026.md`
- VCS policy: `AGENTS.md` (Muse-default for this tree; Git for GitHub-only)
