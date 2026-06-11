# Muse ↔ GitHub history reconciliation — June 2026

**Status:** COMPLETE — Muse `main` is canonical again, GitHub `main` and Muse `main` hold the
identical tree, and the `muse-mirror` workflow is safe to use.

Simple summary: for a few days the project had two slightly different "latest versions" — the
one tracked by Muse (our canonical history) and the one on GitHub (where two emergency fixes had
to ship directly to production). This document records how the two were brought back to a single
identical version, with the GitHub-only emergency work imported into Muse so nothing was lost.

Technical summary: GitHub `main` had four changes absent from Muse (`8ae04be` RBAC
proposal-approval fix + companion app phases 1-6 + MCP OAuth C3/C5 hardening; `d5cfe77` AGENTS.md
muse-mirror mandate; PR #229 hosted MCP discovery timeout hotfix; PR #230 frontmatter
normalization hotfix). Muse `main` had one commit absent from GitHub's *local* clone
(`6f47d53a`, hosted discovery fix) — which turned out to be byte-identical to PR #229's content.
`origin/main` was verified to be a strict superset of the Muse working tree, so reconciliation
was a content import of `origin/main` into Muse, committed as one reconciliation commit, then
mirrored back through the standard `muse-mirror` PR.

## Why this was shelved, and why it is now resolved

On 2026-06-08, two hotfixes had to ship straight from GitHub `main` to production (Netlify
gateway/bridge). The standing instruction was: **do not run `muse-mirror` until reconciled**,
because mirroring the then-current Muse snapshot would have deleted the GitHub-only
companion/native-OAuth files and their test suites from production. Those hotfixes shipped;
this reconciliation closes the gap.

## Divergence inventory (evidence captured 2026-06-10)

State before reconciliation:

| Check | Result |
| --- | --- |
| `muse status` | clean; HEAD `6f47d53a` ("fix(mcp): bound hosted discovery context", 2026-06-08) |
| local git `main` | `583a091` (merge of PR #228); strictly behind `origin/main` (ff possible) |
| `origin/main` | `24051c2` (merge of PR #230) |
| `git diff origin/main` (working tree = Muse main) | 107 D / 18 M; 2 untracked |
| GitHub-only commits | `8ae04be`, `d5cfe77`, PR #229 (`0f34ff3`), PR #230 (`24051c2`) — all confirmed present on `origin/main` |
| Working-tree-only ("Muse-only") added lines vs `origin/main` | **99 lines across 13 files** — every line inspected; all were older shapes superseded by `origin/main` (see below) |

The 107 "deletions" were divergence artifacts, not uncommitted work: companion app libs
(`lib/companion-*.mjs`, `lib/model-runtime-lane.mjs`), native OAuth provider
(`hub/gateway/native-oauth-provider.mjs`, `native-as-store.mjs`), companion design docs
(`docs/COMPANION-APP-*.md`), and the seven-tier test suites for companion,
native-oauth-c1-c6, proposal-approve-rbac-fix, model-runtime-lane, derived-artifact-storage,
and llm-complete-openrouter.

## Findings that shaped the resolution

### 1. The MCP discovery "overlap hazard" was already resolved upstream

Muse `6f47d53a` and GitHub PR #229 were suspected to be independent implementations of the same
hosted MCP discovery fix. Byte-level comparison showed they are the **same implementation**:
`hub/bridge/server.mjs`, `hub/gateway/mcp-proxy.mjs`, `test/bridge-hosted-context-settings.test.mjs`,
`test/gateway-settings-hosted-vault-filter.test.mjs`, and `test/mcp-gateway-proxy.test.mjs` all
diff **zero** between the Muse working tree and `origin/main`. One implementation; nothing to
delete. This also means the Muse-only hosted-context settings endpoint
(`GET /api/v1/hosted-context/settings`) and gateway delegated vault filtering were **already in
production** via PR #229.

### 2. OpenRouter/chat-provider was never deliberately removed in Muse

`muse log --all` shows the OpenRouter/chat-provider work lives on the **unmerged** Muse branch
`feat/companion-design-openrouter-lane` (commits `3b70a5eb`, `7c3a895f`, branched from
`f4def6a1`). It reached GitHub `main` when that branch was mirrored as `ca1f023` (PR #227).
Muse `main` never contained it, so there is **no deliberate Muse removal commit**. Per the
reconciliation rule ("keep the Muse-side removal only if a deliberate Muse commit confirms it"),
the OpenRouter/chat-provider code was **restored from GitHub**.

> **FLAGGED FOR SEPARATE DECISION:** the OpenRouter/chat-provider lane is now in Muse canonical
> history via the reconciliation commit, but the owner has not explicitly merged
> `feat/companion-design-openrouter-lane` into Muse `main`. If removal is wanted, it must be its
> own documented Muse commit through the normal flow.

### 3. `origin/main` is a strict superset of Muse `main`

All 99 working-tree-only lines were individually inspected. Each is an older shape that
`origin/main` superseded:

| File | Muse-only lines were… | Superseded by |
| --- | --- | --- |
| `lib/llm-complete.mjs` (53) | pre-OpenRouter provider docs + Ollama path | OpenRouter lane (superset; DeepInfra/Ollama retained) |
| `web/hub/hub.js` (14) | approve/discard errors appended to `detail-body` | `8ae04be` `showToast` error surfacing |
| `lib/daemon-llm.mjs` (7) | pre-OpenRouter model-override merge | OpenRouter-aware version |
| `mcp/tools/index-enrich.mjs` (6) | simple `ai_summary` write, skip failures | enrich audit lane |
| `test/gateway-auth-refresh-wiring.test.mjs` (5) | offset-window (`slice(g, g+600)`) assertions | `routeBlock` helper matching `8ae04be` server shape |
| `hub/gateway/server.mjs` (3) | pre-normalization note read; pre-fallback role | PR #230 frontmatter normalization; `8ae04be` RBAC fallback |
| `.env.example` (3) | pre-OpenRouter provider notes | OpenRouter lane docs |
| `lib/memory-consolidate.mjs` (2) | direct `mm.store('insight', …)` | Phase 6 (D6.6.2) `DerivedArtifactWriter` routing |
| `docs/HUB-API.md` (2) | pre-normalization GET /notes/:path doc | PR #230 doc update |
| `hub/gateway/mcp-oauth-provider.mjs` (1) | `exchangeAuthorizationCode` ignoring `redirect_uri` | C5 (RFC 6749 §4.1.3) validation + C3 (RFC 9207) `iss` |
| `web/hub/hub-integration-guides.mjs` (1) | 2-kind typedef | `provider` kind (OpenRouter tile) |
| `hub/server.mjs` (1) | plain `loadConfig` import | `loadConfig, CHAT_PROVIDERS, normalizeChatProviderInput` |
| `AGENTS.md` (1) | curly-quote variant of one line | `d5cfe77` muse-mirror mandate section |

Conclusion: importing `origin/main`'s tree loses **zero** unique Muse work.

## Conflict resolutions (as planned, with outcomes)

| Planned conflict | Outcome |
| --- | --- |
| `AGENTS.md` — keep `d5cfe77` mandate | Kept (origin side) |
| `hub/gateway/mcp-oauth-provider.mjs` — keep C3/C5 | Kept (origin side; `iss` emit at L160, `redirect_uri mismatch` reject at L183) |
| `hub/gateway/server.mjs` + `web/hub/hub.js` — keep `8ae04be` RBAC fallbacks + toasts, merged with hosted-context | Kept; hosted-context changes were already merged on origin via PR #229 |
| MCP discovery — keep one implementation | Already one implementation (byte-identical) |
| OpenRouter — keep Muse removal only if deliberate | Not deliberate (unmerged branch); restored from GitHub, flagged above |

## What was done

1. `git fetch origin`; recorded the full divergence inventory before changing anything.
2. `git checkout origin/main -- .` — imported the GitHub-only content into the working tree.
   Verified `git diff origin/main` is empty (tree identity).
3. Ran the full test suite (`npm test`, includes the restored seven-tier companion /
   native-oauth / RBAC / openrouter suites) — all green.
4. Muse reconciliation commit on `main` importing the GitHub-direct history, including this
   document.
5. Local git `main` fast-forwarded to `origin/main` (`git reset --mixed`; pointer-only, no
   content change, no history rewrite).
6. Mirrored Muse `main` → GitHub via the standard `muse-mirror` branch + PR (this document is
   the only file-level delta on the GitHub side, shipped in the same PR as the Muse code
   import it records).
7. Verified GitHub `main` tree == Muse `main` snapshot (empty diff).

## Seven-tier coverage for the merged surface

The merged hosted-context + restored-RBAC/OAuth surface is covered by restored and existing
suites, all green in step 3:

- **Unit / Integration / E2E / Stress / Data-integrity / Performance / Security:**
  `test/proposal-approve-rbac-fix-*.test.mjs` (7 tiers, RBAC fallback decision paths),
  `test/native-oauth-c1-c6-*.test.mjs` (7 tiers, code-exchange validation, `iss`,
  `redirect_uri` mismatch, sessionless MCP rejection),
  `test/companion-*-{unit,integration,e2e,stress,data-integrity,performance,security}.test.mjs`,
  `test/llm-complete-openrouter-*.test.mjs` (7 tiers),
  `test/derived-artifact-storage-*.test.mjs` (7 tiers),
  `test/model-runtime-lane-*.test.mjs` (7 tiers).
- **Hosted-context settings + vault filtering:** `test/bridge-hosted-context-settings.test.mjs`,
  `test/gateway-settings-hosted-vault-filter.test.mjs` (allowlist never widens; 403 → empty
  allowlist; forged `X-User-Id` rejected; no canister enumeration with explicit delegated IDs;
  60s-cache budget), `test/mcp-gateway-proxy.test.mjs`.
- **Frontmatter normalization:** `test/gateway-hosted-notes-frontmatter.test.mjs`.

## Current operating procedure (unchanged, now unblocked)

1. Develop on a Muse feature branch; merge to Muse `main` after tests are green.
2. Mirror every Muse `main` merge to GitHub via the `muse-mirror` branch + PR
   (mandated in `AGENTS.md`; never push directly to GitHub `main`).
3. Deploy follows GitHub `main` (Netlify).

Do not reopen this reconciliation unless a future status check proves Muse `main` and GitHub
`main` have diverged again.

## Exit criteria

- [x] `muse status` clean after the reconciliation commit.
- [x] `git status` clean; local `main` == `origin/main`.
- [x] GitHub `main` tree == Muse `main` snapshot (empty file-level diff).
- [x] Full suite green on the reconciled tree.
- [x] Production verified (live probes, 2026-06-10): gateway healthy;
      `GET /api/v1/hosted-context/settings` live and 401s both unauthenticated and forged
      `X-User-Id` requests; OAuth discovery serves the canonical issuer; token exchange rejects
      malformed requests (400 `invalid_request`); sessionless MCP non-initialize rejected
      (-32600 / 401). The `redirect_uri`-mismatch and delegated-vault-visibility paths require
      valid credentials to probe live; they are verified by the green
      `native-oauth-c1-c6-security` and `gateway-settings-hosted-vault-filter` suites against
      the identical tree that is deployed.
- [x] This document merged with the code in the same PR.

## Follow-up decisions resolved

### OpenRouter / chat-provider lane — formally adopted (2026-06-11)

**Decision: KEEP.**

During the reconciliation, `origin/main` was imported as a strict superset of local Muse
state. One side-effect was that the OpenRouter provider lane (originally on the unmerged
branch `feat/companion-design-openrouter-lane`, mirrored to GitHub via PR #227) became
canonical in Muse `main` without an explicit owner decision. This entry is that decision.

**What was reviewed:**

- `lib/llm-complete.mjs` — `openrouterChat()` function and provider-selection switch. The
  lane is explicit-only: it activates only when `KNOWTATION_CHAT_PROVIDER=openrouter` is
  set. The code comment at line 21 states this directly: *"adding `OPENROUTER_API_KEY` to
  an environment cannot change the provider for an existing deployment unless
  `KNOWTATION_CHAT_PROVIDER=openrouter` is also set."*
- `lib/config.mjs` — `CHAT_PROVIDERS` enum includes `openrouter` as a peer of `deepinfra`,
  `openai`, `anthropic`, and `ollama`. No special-case handling.
- `test/llm-complete-openrouter-*.test.mjs` — full seven-tier coverage (unit, integration,
  e2e, stress, data-integrity, performance, security). No credential-shaped test markers.

**Why kept:** The lane is a genuine "bring your own key" aggregator option — the operator
supplies `OPENROUTER_API_KEY` and Knowtation routes through OpenRouter's unified API,
giving access to a wide range of models without any managed-key exposure on Knowtation's
side. It is never a default and cannot be silently activated. There is no code quality,
security, or architectural issue. Removal would discard real functionality for no gain.

**Config surface (for operators):**

| Env var | Required | Default |
|---|---|---|
| `KNOWTATION_CHAT_PROVIDER=openrouter` | yes (opt-in) | — |
| `OPENROUTER_API_KEY` | yes | — |
| `OPENROUTER_CHAT_MODEL` | no | `openai/gpt-4o-mini` |
| `OPENROUTER_SITE_URL` | no | — |
| `OPENROUTER_APP_TITLE` | no | — |

## Related documents

- `docs/COMPANION-APP-OAUTH-SERVERSIDE-GATE.md` — C1–C6 OAuth hardening contract (C3/C5 shipped).
- `docs/COMPANION-APP-PHASE-*.md` — companion app phases 1-6 (restored to Muse canonical).
- `docs/HUB-API.md` — frontmatter normalization contract (PR #230).
- Scooling `docs/GITHUB-MIRROR-RECONCILIATION-FOLLOWUP.md` — the model for this record.
