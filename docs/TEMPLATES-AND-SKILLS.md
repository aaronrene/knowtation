# Templates, Skills, and MCP Prompts

Knowtation has three layers that work together to help users and agents be productive in any domain. This document explains what each layer is, how they compose, and how to use them.

---

## The three layers

### Layer 1 — Vault Templates (content)

Pre-filled folder structures with example Markdown notes. They live under `vault/templates/<name>/` and get seeded into any vault via the seed script or CLI.

**What they answer:** "What should good notes look like in my domain?"

A template is passive content. It does not change how the system works; it gives you a starting point with realistic folder layouts, frontmatter patterns, and example notes. Think of it as a starter kit.

### Layer 2 — Agent Skill Packs (behavior)

SKILL.md files that teach AI agents how to behave in a specific role. They live under `.cursor/skills/packs/<name>/SKILL.md` and work with Cursor, Claude Code, or any runtime that reads skill files.

**What they answer:** "How should an agent act when working in this domain?"

A skill pack tells the agent what to search for, what workflows to follow, what MCP prompts to invoke, and what output format to produce. Skills reference templates (for domain context) and MCP prompts (for tools). Think of it as an agent persona or playbook.

### Layer 3 — MCP Prompts (tools)

Server-side prompt templates invoked via the MCP protocol. Knowtation ships 13 prompts that pull live vault data (search results, note bodies, memory events) and compose it into structured prompts.

**What they answer:** "What pre-built workflows can agents invoke?"

Available prompts: `daily-brief`, `search-and-synthesize`, `project-summary`, `meeting-notes`, `content-plan`, `temporal-summary`, `extract-entities`, `knowledge-gap`, `causal-chain`, `write-from-capture`, `memory-context`, `memory-informed-search`, `resume-session`.

### How they compose

```
Templates ──── "Here is what good content looks like"
    │
    ▼
Skills ──────── "Here is how the agent should behave"
    │
    ▼
MCP Prompts ── "Here are tools that pull live vault data"
    │
    └──────── Results feed back into template-structured vault
```

A `marketing-writer` skill pack says "use the `content-plan` MCP prompt to pull recent project notes, then draft a blog post following the structure in the `content-creation` template."

---

## One vault, one template — that works

A user can seed a single vault with a single template and use it for everything. Templates are suggestions, not constraints. You can also:

- Create multiple vaults with different templates (one for business, one for research, one for personal) and agents reference whichever vault is active
- Mix and match folder structures within a single vault
- Start with one template and add folders from another later

---

## Available templates

| Template | Domain | Key folders |
|----------|--------|-------------|
| `research-lab` | Academic / scientific teams | `literature/`, `protocols/`, `experiments/`, `meetings/`, `decisions/` |
| `business-ops` | Startups, agencies, consulting | `decisions/`, `meetings/`, `playbooks/`, `customers/`, `competitive/` |
| `finance` | Portfolio, tax, blockchain, audit | `thesis/`, `positions/`, `transactions/`, `reports/`, `tax/` |
| `engineering-team` | Software and product teams | `architecture/`, `runbooks/`, `incidents/`, `retrospectives/`, `onboarding/` |
| `personal-knowledge` | Individual knowledge workers | `inbox/`, `projects/`, `areas/`, `reference/`, `journal/` |
| `smart-home` | Home automation, IoT, household | `devices/`, `automations/`, `energy/`, `maintenance/`, `household/` |
| `content-creation` | Books, blogs, newsletters, creative | `drafts/`, `research/`, `outlines/`, `published/`, `style-guide/` |
| `education` | Courses, curriculum, study groups | `courses/`, `assignments/`, `study-notes/`, `resources/`, `schedule/` |

### How to seed a template

**Self-hosted:** Point `vault_path` at `vault/templates/<name>/` or copy the folder into your vault.

**Hosted (canister):**

```bash
KNOWTATION_SEED_DIR=templates/business-ops \
KNOWTATION_HUB_URL="https://YOUR-GATEWAY" \
KNOWTATION_HUB_TOKEN="YOUR_JWT" \
npm run seed:hosted-showcase
```

---

## Available skill packs

### Domain skills

| Skill | Role | Key workflows |
|-------|------|---------------|
| `research-assistant` | Literature review, synthesis | `search-and-synthesize`, entity extraction, causal chains |
| `business-analyst` | Decisions, meetings, competitive intel | `meeting-notes`, `project-summary`, ADR creation |
| `financial-ops` | Transactions, audit, portfolio | Wallet note search, attestation, periodic reports |

### Marketing and organization agents

These 7 agents form a complete marketing pipeline. Each is a standalone skill pack so different agent instances can run them in parallel.

| Skill | Role | Outputs |
|-------|------|---------|
| `marketing-research` | Market intel, competitors, trends | Research briefs, competitive analysis, trend reports |
| `marketing-strategy` | Positioning, campaigns, audience | Strategy docs, campaign briefs, personas |
| `marketing-writer` | Blog posts, copy, email, social | Drafts, email sequences, social threads |
| `marketing-editor` | Review, refine, enforce style | Editorial feedback, revised drafts |
| `marketing-visual` | Asset briefs, brand guidelines | Image specs, brand notes, mockup descriptions |
| `marketing-distribution` | Channel planning, post tracking | Distribution plans, channel checklists |
| `marketing-analytics` | KPIs, performance, optimization | Performance reports, optimization recommendations |

### How to activate a skill pack

Copy the skill folder to your `.cursor/skills/` directory, or reference it from your agent configuration. Skills compose with the base `knowtation` skill (which covers generic CLI/MCP usage).

---

## Related docs

- [IMPORT-SOURCES.md](./IMPORT-SOURCES.md) — All import sources and formats
- [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md) — CLI, MCP, Hub API for agents
- [SHOWCASE-VAULT.md](./SHOWCASE-VAULT.md) — Demo vault and seed scripts
- [AGENT-ORCHESTRATION.md](./AGENT-ORCHESTRATION.md) — Multi-agent patterns
