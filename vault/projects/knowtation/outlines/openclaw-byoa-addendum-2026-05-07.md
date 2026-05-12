---
title: OpenClaw BYOA addendum — Phase 8 of the MuseHub Knowtation plan (2026-05-07)
date: 2026-05-07
project: knowtation
tags: [plan, addendum, openclaw, paperclip, byoa, channels, integrations, musehub, knowtation]
revision: 1
last_review: 2026-05-07
editor: aaronrene
status: planned
references:
  - staging.musehub.ai/gabriel/muse/issues/2
  - vault/projects/knowtation/research/2026-05-07-architecture-final-decision.md
  - deploy/paperclip/agents/_universal-preamble.yaml
depends_on:
  - vault/projects/knowtation/research/2026-05-07-architecture-final-decision.md
---

# Phase 8 — OpenClaw BYOA adapter for Paperclip (addendum to the MuseHub Knowtation domain plan)

> **Why this exists.** The MuseHub Knowtation domain plan (Phases 1-7) is the substrate-and-attestation work. This Phase 8 is the deliberate, named follow-on that brings the **agent worker layer into the picture**: a `paperclip-plugin-openclaw` BYOA adapter so Paperclip can hire OpenClaw bots, and so we can turn on chat-channel surfaces (WhatsApp, Discord, Email/SMTP, Slack, iMessage, Telegram, Signal) without writing custom adapters per channel.
>
> **Why now.** OpenClaw was the very first agent runtime considered before Knowtation existed. The arc has come back to it. We are not abandoning it — we are placing it in the right architectural slot: a worker hired by Paperclip on top of a Muse-backed Knowtation substrate.
>
> **When to start.** After MuseHub Phases 1-5 ship and the video factory has been running on the YAML-agent worker pattern for at least 4-6 weeks (real operational data). OR: when a concrete channel use case becomes the next product priority (whichever comes first).

---

## 0. Plain-language summary

**Plain:** Paperclip is the org chart that runs your AI workers. Today those workers are simple YAML prompts. Phase 8 teaches Paperclip how to "hire" OpenClaw bots as a second kind of worker. Once that's in place, every channel OpenClaw already supports (WhatsApp, Discord, Slack, Email, iMessage, Signal, Telegram) and every integration it already has (Gmail, Calendar, Notion, Linear, Jira, GitHub, etc.) becomes available to your business as a configuration flag — not as months of custom code.

**Technical:** implement `paperclip-plugin-openclaw` (a TypeScript adapter modeled on `paperclip-plugin-acp`) that bridges Paperclip's heartbeat/ticket API to OpenClaw's session model; register OpenClaw bots in Paperclip's BYOA registry; wire the bots' MCP client at the substrate layer (Muse-backed Knowtation Hub); write 7-tier tests; deploy under the existing Paperclip systemd unit on the existing AWS box (no new infra).

## 1. Trigger conditions (when do we start Phase 8?)

Pick one. Whichever comes first:

- **Operational confidence**: video factory has run on the Paperclip YAML-agent pattern for ≥4 weeks with monitored cost, drafts approved, no untracked failures.
- **Channel demand**: a concrete need surfaces for one of:
  - Born Free customer support on WhatsApp.
  - A personal-AI Slack/iMessage bot for the team that reads/writes the vault.
  - Store Free shopper bot in chat (channel TBD when launched).
  - Knowtation user-facing assistant (Discord or Slack first, depending on the audience).
  - Email/SMTP triage bot for any of the above.
- **Integration demand**: a concrete need to wire one of OpenClaw's pre-built integrations (Gmail, Calendar, Notion, Linear, Jira, GitHub) into a workflow.

**Do NOT start Phase 8 before either trigger is real.** Building it on speculation violates Rule #1 (no temporary fixes / no premature work).

## 2. Sub-phases

### 8.1 — Paperclip BYOA primer (research, no code)

- Read Paperclip's plugin SDK docs end-to-end. Specifically the heartbeat lifecycle, ticket assignment, budget enforcement, return-value contract.
- Read `paperclip-plugin-acp` (the Claude Code / Codex / Gemini CLI adapter) source as the reference implementation.
- Capture findings in `vault/projects/knowtation/research/paperclip-byoa-sdk-notes.md`.
- **Tier targets:** unit (none — research). Output: a 1-2 page brief.
- **Estimate:** 2-3 days.

### 8.2 — Local OpenClaw 4.x install + Knowtation MCP smoke

- Install OpenClaw at the latest stable 4.x **pinned to a specific version** (do not auto-track).
- Configure OpenClaw's MCP client to point at the staging Knowtation Hub with a scoped JWT (read-vault + propose-draft only, never `publish`).
- Build one trivial OpenClaw skill: "given a Born Free topic, search the vault, draft a one-paragraph script summary, write to drafts/."
- Run end-to-end. Validate the universal preamble's voice gate (read style guide → read positioning → cite vault paths → mark unanchored claims as `[NEEDS CONFIRMATION]`) is enforceable inside OpenClaw's prompt model.
- **Tier targets:** unit (skill validates inputs), integration (OpenClaw → Knowtation MCP round-trip), security (JWT scope refusal: try to publish, must be denied server-side).
- **Estimate:** 3-5 days.

### 8.3 — `paperclip-plugin-openclaw` adapter v1

- TypeScript module under `deploy/paperclip/plugins/openclaw/` (or wherever Paperclip's plugin loader expects it). Roughly 200-400 lines.
- Functional contract:
  1. Receive a Paperclip ticket (heartbeat) with `{ task_id, agent_id, project_id, prompt_context, budget_remaining, deadline }`.
  2. Spawn or wake an OpenClaw session bound to the agent_id; pass the prompt context.
  3. Stream OpenClaw output; capture cost/latency/usage.
  4. Return the result to Paperclip via the BYOA result API. Surface failures with structured error codes.
  5. Honor budget caps (refuse to start if `budget_remaining` exhausted; halt mid-run if exceeded).
- **Tier targets:** unit (adapter shape, error codes, budget enforcement), integration (full Paperclip → adapter → OpenClaw → Paperclip round-trip), data-integrity (no message dropped on retry), performance (heartbeat round-trip p95 < 2s on no-op tasks), security (replay protection, signature on adapter result, no JWT exfiltration to OpenClaw logs), end-to-end (one real ticket from Paperclip dashboard → drafted output in vault), stress (10 parallel tickets across 3 OpenClaw bots without deadlock).
- **Estimate:** 1-2 weeks.

### 8.4 — Hire the first OpenClaw bot in Paperclip

- Define the bot's role in `deploy/paperclip/agents/<project>/bots/<botname>.yaml`.
- Configure its skills (which OpenClaw plugins it has access to, e.g., `mcp-knowtation`, `slack-channel`).
- Set its budget cap.
- Wire it into a single project's company.
- Run a parallel comparison: same task to a YAML agent and to the OpenClaw bot, compare output quality + cost + latency.
- **Tier targets:** integration (bot fires, returns, budgets respected), data-integrity (output matches/exceeds YAML agent baseline), performance (cost ≤ 1.5× YAML agent for equivalent task).
- **Estimate:** 2-3 days.

### 8.5 — First channel adapter

Pick whichever channel matches the trigger condition. Likely: Slack OR WhatsApp.

- Turn on OpenClaw's pre-built channel adapter for that platform.
- Bind the OpenClaw bot from 8.4 to the channel.
- Implement the human-approval gate: any message that proposes a vault write goes to Paperclip's ticket approval queue first.
- **Tier targets:** integration (channel → OpenClaw → Paperclip ticket), security (bot cannot write to vault without human approval; channel-level abuse rate-limited; signed webhooks where supported), end-to-end (real human DMs the bot, gets a real reply from the vault).
- **Estimate:** 3-5 days for the first channel; 1-2 days each for subsequent channels.

### 8.6 — Productivity integrations (turn on as needed)

For each integration (Gmail, Calendar, Notion, Linear, Jira, GitHub, Trello, etc.):

- Verify OpenClaw's official plugin is the source (do not roll our own).
- Configure read scopes minimally; never grant write scopes that could damage external systems without a Paperclip-level approval gate.
- Bind to the right OpenClaw bot.
- **Tier targets:** integration + security (least-privilege scope, secret rotation tested, no plain-text credentials in logs).
- **Estimate:** 1-3 days per integration.

### 8.7 — Channel-aware org chart in Paperclip

- Create per-channel "companies" in Paperclip if useful (e.g., `bornfree-support` is a separate company from `bornfree-content` even though both are Born Free, because their budgets, hires, and oversight differ).
- Wire the relevant OpenClaw bots into each company.
- Set per-company monthly budgets and approval gates.
- **Tier targets:** integration; data-integrity (multi-company isolation across OpenClaw bots).
- **Estimate:** 2-4 days for the first channel-company; 1-2 days for each additional channel.

## 3. Dependencies

- **Hard:** MuseHub Knowtation domain Phases 1-5 must be live (substrate + memory timeline + MCP surface). Phase 8 depends on the Muse-backed MCP being the source of truth for vault provenance, otherwise OpenClaw bots have no enforceable identity-chain on their writes.
- **Soft:** MuseHub Phase 7 (attestation + org-quorum) preferred but not blocking. Phase 8 can ship with HMAC-only attestation; org-quorum is added as a strengthening pass when Phase 7.7 lands.
- **External:** OpenClaw's foundation governance transition (currently in progress per Steinberger blog 2026-02-14). Track via the OpenClaw repo and GitHub releases; pin a version; do not auto-upgrade across major bumps without spike-testing.
- **Internal:** the gateway tier router (`lib/llm-complete.mjs`'s `tier: 'cheap' | 'standard' | 'premium-judgment'` work) should land before Phase 8 so OpenClaw bots can route triage steps to cheap models without writing per-bot config.

## 4. Risks

| Risk | Mitigation |
|---|---|
| OpenClaw 4.x API drift between versions | Pin to specific version per `paperclip-plugin-openclaw`; integration test on every upgrade |
| OpenClaw foundation governance transitions (in progress, not yet legally formed) | MIT license is the legal backstop; we keep a fork-ready position |
| BYOA adapter complexity higher than the 1-2 week estimate | Stop and reassess at the 2-week mark per Rule #3; do not push through |
| Channel adapter maturity varies per platform | Don't assume all channels are equally polished; run a per-channel spike before turning on for production |
| Per-claim provenance gap if we ship channels before Muse Phase 7 | Run with HMAC-only attestation; explicitly mark drafts as "not yet org-quorum-attested" in frontmatter; backfill when Phase 7 ships |
| Budget overrun via channel-DM-driven LLM loops | Hard budget cap in Paperclip per bot; rate-limit per channel; alarm at 80% utilization |

## 5. Cross-cutting deliverables

Per the master MuseHub plan and per Aaron's standing rules:

- **Tests:** all 7 tiers (unit, integration, end-to-end, stress, data-integrity, performance, security) — every PR. Per Rule #0.
- **Docs:** every channel + integration that goes live gets a one-page brief in `docs/marketing-internal/` describing trigger, scope, approval gate, rollback. Per Rule #5.
- **Secrets:** all OpenClaw bot tokens, channel webhooks, and integration credentials live in AWS SSM Parameter Store under `/knowtation/openclaw/*`. Hot-reloaded per the existing `paperclip-secrets-sync.timer`. Per Rule #6.
- **Rollback:** every channel can be disabled by removing the bot's config; every integration by revoking the OAuth scope. Document the per-channel kill switch in the brief.
- **Audit:** every OpenClaw bot action is a Paperclip ticket; every vault write is a Muse-attested commit. Per the substrate-and-org-chart contract.

## 6. Token-budget split (for the agent who does this work)

- **Sonnet-heavy:** 8.1, 8.2, 8.4, 8.5, 8.6 (mostly mechanical wiring on top of mature SDKs).
- **OBA-heavy:** 8.3 (adapter design must be misuse-resistant), 8.7 (multi-company governance modeling).
- **Mixed:** none.

## 7. Completion criteria

Phase 8 is "done" when:

1. The `paperclip-plugin-openclaw` adapter is merged, tested at all 7 tiers, and running in the existing Paperclip systemd unit.
2. At least one OpenClaw bot is hired in Paperclip and producing vault-cited drafts equivalent to (or better than) the YAML-agent baseline.
3. At least one chat channel (Slack OR WhatsApp) is bound to that OpenClaw bot with a working human-approval gate.
4. At least one productivity integration (Gmail, Calendar, Notion, Linear, Jira, OR GitHub) is wired with least-privilege scopes and a documented kill switch.
5. The decision audit trail in `vault/projects/knowtation/research/2026-05-07-architecture-final-decision.md` is updated with measured outcomes (Rule #2: data, not vibes).

## 8. What this addendum explicitly does NOT cover

- **Migrating the video factory's YAML agents to OpenClaw bots.** The YAML agents stay. They handle batch server-side jobs well. OpenClaw is for channel-aware and integration-heavy use cases.
- **Replacing Paperclip with OpenClaw.** Paperclip stays as the org-chart layer. OpenClaw is hired by Paperclip, not the other way around.
- **Rolling our own channel adapters.** We use OpenClaw's pre-built channel adapters. If a channel we need doesn't have one, we evaluate alternatives before writing custom code.
- **Agent-to-agent commerce primitives.** That work belongs in MuseHub Phase 7 (attestation + org-quorum) and any successor phase. Phase 8 only consumes those primitives.

---

*Updates to this addendum should bump `revision`, append a Changelog section, and be reflected in the master decision doc (`vault/projects/knowtation/research/2026-05-07-architecture-final-decision.md`) at the same time. Per Rule #3, never amend a phase already marked complete — write a new addendum that supersedes it.*
