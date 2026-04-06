# Documentation index

Public documentation for **Knowtation** (open source). Spec, API contracts, deployment, and contributor-facing guides live here.

## Start here

| Doc | Purpose |
|-----|---------|
| [GETTING-STARTED.md](./GETTING-STARTED.md) | Clone, config, index, search, Hub, agents |
| [SHOWCASE-VAULT.md](./SHOWCASE-VAULT.md) | Demo notes (`vault/showcase/`) — local tree + hosted seed |
| [SPEC.md](./SPEC.md) | Data formats, CLI, config — source of truth |
| [HUB-API.md](./HUB-API.md) | Hub REST API (self-hosted and canister-aligned) |
| [HUB-METADATA-BULK-OPS.md](./HUB-METADATA-BULK-OPS.md) | Delete/rename by project slug (Node Hub + hosted gateway; Hub client PR #65) |
| [VAULT-RENAME-SPEC.md](./VAULT-RENAME-SPEC.md) | Vault id migration vs display label (planning spec) |
| [setup.md](./setup.md) | Extended setup (OAuth, transcription, etc.) |

## Architecture and agents

| Doc | Purpose |
|-----|---------|
| [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) | CLI, MCP, Cursor — integrating agents |
| [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md) | MCP + orchestration patterns |
| [ECOSYSTEM-VISION.md](./ECOSYSTEM-VISION.md) | Knowtation × Muse × MuseHub × AgentCeption × Stori — unified vision |
| [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md) | CLI reference and retrieval tips |
| [TOKEN-SAVINGS.md](./TOKEN-SAVINGS.md) | Consolidation, Discover, hosted billing per run, encrypt-aware prompts, advanced knobs, phased rollout |
| [IMPORT-SOURCES.md](./IMPORT-SOURCES.md) | Import paths from ChatGPT, Claude, etc. |
| [BACKLOG-MCP-SUPERCHARGE.md](./BACKLOG-MCP-SUPERCHARGE.md) | MCP roadmap and phased features |

## Hosted product (ICP + gateway + bridge)

| Doc | Purpose |
|-----|---------|
| [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) | Deploy checklist, re-verification (§5) |
| [STATUS-HOSTED-AND-PLANS.md](./STATUS-HOSTED-AND-PLANS.md) | Current hosted status and priorities |
| [PARITY-PLAN.md](./PARITY-PLAN.md) | Self-hosted vs hosted capability matrix |
| [HOSTED-IMPORT-DESIGN.md](./HOSTED-IMPORT-DESIGN.md) | Replace gateway **501** on import (**P0** before billing completion) |
| [CANISTER-AUTH-CONTRACT.md](./CANISTER-AUTH-CONTRACT.md) | Gateway ↔ canister auth |
| [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md) | Multi-vault (self-hosted + hosted) |
| [HOSTED-WORKSPACE-ACCESS.md](./HOSTED-WORKSPACE-ACCESS.md) | Hosted team: workspace owner, vault access, scope, gateway headers |
| [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md) | Stable storage + billing migration |
| [HOSTED-PLATFORM-BACKUP-ROADMAP.md](./HOSTED-PLATFORM-BACKUP-ROADMAP.md) | Operator DR / canister backup planning (future) |
| [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md) | Hosted billing design |
| [PRODUCT-DECISIONS-HOSTED-MVP.md](./PRODUCT-DECISIONS-HOSTED-MVP.md) | Hosted MVP: transcription vs Markdown; self-hosted audio; metering focus |

## Product and phases

| Doc | Purpose |
|-----|---------|
| [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) | Phases 1–16+ roadmap |
| [WHITEPAPER.md](./WHITEPAPER.md) | Product thesis |
| [TWO-PATHS-HOSTED-AND-SELF-HOSTED.md](./TWO-PATHS-HOSTED-AND-SELF-HOSTED.md) | Cloud vs self-host |
| [LOCAL-DEV-TEST-GUIDE.md](./LOCAL-DEV-TEST-GUIDE.md) | Test checklist: notes to add, Hub UI checks, CLI commands |

## Manual / phase tests (local developers)

| Doc | Purpose |
|-----|---------|
| [INDEX-SEARCH-VERIFY.md](./INDEX-SEARCH-VERIFY.md) | CLI index/search, Qdrant vs sqlite-vec, Ollama, Hub search UX notes |
| [PHASE4-MANUAL-TEST.md](./PHASE4-MANUAL-TEST.md) … [PHASE9-MANUAL-TEST.md](./PHASE9-MANUAL-TEST.md) | Step-by-step checks after feature work |

## Other

| Doc | Purpose |
|-----|---------|
| [archive/cursor-plans/](./archive/cursor-plans/) | Snapshots of Cursor plan files (token-savings, OB1 analysis) — not loose in `.cursor/plans/` |
| [HUB-PROPOSAL-LLM-FEATURES.md](./HUB-PROPOSAL-LLM-FEATURES.md) | Proposal **review hints** vs **Enrich** (LLM); roadmap pointer to extended Enrich |
| [PROPOSAL-ENRICH-EXTENSION-PLAN.md](./PROPOSAL-ENRICH-EXTENSION-PLAN.md) | Plan: Enrich → recommend project, chain, entity, episode, follows, title, … |
| [openapi.yaml](./openapi.yaml) | OpenAPI sketch for Hub API |
| [CLI-JSON-SCHEMA.md](./CLI-JSON-SCHEMA.md) | CLI JSON shapes |
| [MUSE-STYLE-EXTENSION.md](./MUSE-STYLE-EXTENSION.md) | Proposals / variation protocol notes |

Session-only notes, forensic write-ups, and per-phase MCP implementation memos were **removed from this tree** for a cleaner OSS repo; maintainers may keep copies under **`development/`** (see repo `.gitignore`).
