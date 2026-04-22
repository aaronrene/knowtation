# Documentation index

Public documentation for **Knowtation** (open source). Spec, API contracts, and contributor-facing guides live here.

Internal roadmaps, deploy runbooks, and session handoffs live outside this tree (for example under a local **`development/`** or **`docs/archive/`** folder — see repo `.gitignore`).

## Start here

| Doc | Purpose |
|-----|---------|
| [GETTING-STARTED.md](./GETTING-STARTED.md) | Clone, config, index, search, Hub, agents |
| [SHOWCASE-VAULT.md](./SHOWCASE-VAULT.md) | Demo notes (`vault/showcase/`) — local tree + hosted seed |
| [SPEC.md](./SPEC.md) | Data formats, CLI, config — source of truth |
| [WHITEPAPER.md](./WHITEPAPER.md) | Long-form thesis; **§ Product updates (April 2026)** for prime, doctor, import expansion, Hub bulk, docs hygiene |
| [HUB-API.md](./HUB-API.md) | Hub REST API (self-hosted and canister-aligned) |
| [HUB-METADATA-BULK-OPS.md](./HUB-METADATA-BULK-OPS.md) | Delete/rename by project slug (Node Hub + hosted gateway) |
| [setup.md](./setup.md) | Extended setup (OAuth, transcription, etc.) |
| [SELF-HOSTED-SETUP-CHECKLIST.md](./SELF-HOSTED-SETUP-CHECKLIST.md) | Self-hosted checklist |

## Architecture and agents

| Doc | Purpose |
|-----|---------|
| [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) | CLI, MCP, Cursor — integrating agents |
| [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md) | MCP + orchestration patterns |
| [ECOSYSTEM-VISION.md](./ECOSYSTEM-VISION.md) | Knowtation × Muse × MuseHub × AgentCeption × Stori — unified vision |
| [MUSE-THIN-BRIDGE.md](./MUSE-THIN-BRIDGE.md) | Optional Muse linkage (env, approve `external_ref`, admin read-only proxy) |
| [RETRIEVAL-AND-CLI-REFERENCE.md](./RETRIEVAL-AND-CLI-REFERENCE.md) | CLI reference and retrieval tips |
| [TOKEN-SAVINGS.md](./TOKEN-SAVINGS.md) | Token discipline, consolidation, hosted billing hooks |
| [IMPORT-SOURCES.md](./IMPORT-SOURCES.md) | All **17** `source_type` importers, Hub in-browser ZIP + multi-file (see also **IMPORT-URL-AND-DOCUMENTS-PHASES**) |
| [IMPORT-URL-AND-DOCUMENTS-PHASES.md](./IMPORT-URL-AND-DOCUMENTS-PHASES.md) | URL, PDF, DOCX, and Hub bulk (4A–4B) — **roadmap, shipped status, testing, merge notes** |
| [PROPOSAL-LIFECYCLE.md](./PROPOSAL-LIFECYCLE.md) | Hub proposals: states, review, approve/discard |
| [TWO-PATHS-HOSTED-AND-SELF-HOSTED.md](./TWO-PATHS-HOSTED-AND-SELF-HOSTED.md) | Cloud vs self-host |

## Hosted / operators (high level)

| Doc | Purpose |
|-----|---------|
| [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md) | Multi-vault (self-hosted + hosted) |
| [PARITY-MATRIX-HOSTED.md](./PARITY-MATRIX-HOSTED.md) | Hosted vs self-hosted capability matrix |
| [OPERATOR-BACKUP.md](./OPERATOR-BACKUP.md) | Operator backup notes |
| [CONNECT-GITHUB-AND-STORAGE-CHECK.md](./CONNECT-GITHUB-AND-STORAGE-CHECK.md) | GitHub connect + storage checks |

Gateway and canister deploy details: **`hub/gateway/README.md`**, **`hub/icp/`** Motoko sources and `dfx` workflow.

## Memory, imports, evals

| Doc | Purpose |
|-----|---------|
| [MEMORY-AUGMENTATION-PLAN.md](./MEMORY-AUGMENTATION-PLAN.md) | Memory architecture and rollout |
| [MEMORY-CONSOLIDATION-GUIDE.md](./MEMORY-CONSOLIDATION-GUIDE.md) | Consolidation daemon |
| [IMPORT-NORMALIZE-PIPELINE.md](./IMPORT-NORMALIZE-PIPELINE.md) | Import normalization |
| [IMPORT-EVALS.md](./IMPORT-EVALS.md) | Import evaluations |
| [IMPORT-MANUAL-CHECKLIST.md](./IMPORT-MANUAL-CHECKLIST.md) | Manual import checks |
| [DAEMON-CONSOLIDATION-SPEC.md](./DAEMON-CONSOLIDATION-SPEC.md) | Daemon consolidation spec |

## Manual checks (local developers)

| Doc | Purpose |
|-----|---------|
| [INDEX-SEARCH-VERIFY.md](./INDEX-SEARCH-VERIFY.md) | CLI index/search, stores, Hub search UX notes |
| [LOCAL-DEV-TEST-GUIDE.md](./LOCAL-DEV-TEST-GUIDE.md) | Local dev smoke checks |

## Other

| Doc | Purpose |
|-----|---------|
| [openapi.yaml](./openapi.yaml) | OpenAPI sketch for Hub API |
| [CLI-JSON-SCHEMA.md](./CLI-JSON-SCHEMA.md) | CLI JSON shapes |
| [HUB-PROPOSAL-LLM-FEATURES.md](./HUB-PROPOSAL-LLM-FEATURES.md) | Proposal review hints vs Enrich (LLM) |
| [AI-ASSISTED-SETUP.md](./AI-ASSISTED-SETUP.md) | AI-assisted onboarding prompts |

Additional topical docs in this folder (security, AIR, blockchain frontmatter, templates, etc.) are listed alphabetically in the repo file tree.
