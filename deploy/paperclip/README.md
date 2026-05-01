# Paperclip on AWS — Knowtation video factory

This directory contains everything needed to stand up Paperclip (the open-source agent orchestrator) on an AWS `t3.medium` instance, wire it to your Knowtation hosted Hub via MCP, and run the 22-agent video factory across Born Free, Store Free, and Knowtation.

**You should not be reading this directly.** Follow [`docs/marketing-internal/RUNBOOK-VIDEO-FACTORY-2026-04-30.md`](../../docs/marketing-internal/RUNBOOK-VIDEO-FACTORY-2026-04-30.md) — this README is the agent-facing reference for what's in each sub-directory.

## Layout

```
deploy/paperclip/
├── README.md                          # this file
├── terraform/                         # AWS infra (EC2, security group, IAM role, SSM)
│   ├── main.tf                        # primary resources
│   ├── variables.tf                   # tunables (region, instance type, your home IP)
│   ├── outputs.tf                     # public IP, instance ID, Tailscale join URL
│   └── versions.tf                    # provider version pins
├── install.sh                         # one-shot: Node 20 + pnpm + Postgres 16 + Paperclip + nginx + LE
├── scripts/                           # operator scripts run AFTER install.sh
│   ├── push-secrets.sh                # interactive: pushes secrets to AWS SSM
│   ├── hello-world-test.sh            # smoke-tests Paperclip can talk to DeepInfra
│   ├── wire-knowtation-mcp.sh         # adds hosted Knowtation MCP endpoint
│   ├── load-skills-and-agents.sh      # imports skills/* and agents/* into Paperclip
│   └── run-controller.sh              # triggers the controller agent for all 3 projects
├── skills/                            # 5 reusable Knowtation skills (Node 20 .mjs modules)
│   ├── read-style-guide.mjs           # pulls vault/projects/<project>/style-guide/voice-and-boundaries.md
│   ├── read-positioning.mjs           # pulls vault/projects/<project>/outlines/positioning-and-messaging-2026-04.md
│   ├── read-playbook.mjs              # pulls any vault/projects/<project>/playbooks/<slug>.md
│   ├── search-vault.mjs               # semantic search scoped to one project
│   └── write-draft.mjs                # writes drafts back to vault with frontmatter
└── agents/                            # 22 agent definitions (YAML)
    ├── controller/
    │   └── controller.yaml            # orchestrates 18 per-project agents in parallel
    ├── bornfree/                      # 6 conveyor-belt agents for Born Free
    │   ├── script-writer.yaml
    │   ├── social-poster.yaml
    │   ├── thumbnail-brief.yaml
    │   ├── clip-factory.yaml
    │   ├── blog-seo.yaml
    │   └── newsletter.yaml
    ├── storefree/                     # 6 for Store Free (mirror structure)
    ├── knowtation/                    # 6 for Knowtation (mirror structure)
    └── bridges/                       # 3 SaaS bridge agents
        ├── heygen-render.yaml
        ├── elevenlabs-tts.yaml
        └── descript-import.yaml
```

## Tests

All testable code in this tree is unit-tested under `test/paperclip-*.test.mjs` at the repo root. Per Aaron's Rule #0, no agent or skill ships to the AWS box unless its test passes locally first.

- `test/paperclip-knowtation-skills.test.mjs` — unit tests for the 5 skills
- `test/paperclip-agent-fixtures.test.mjs` — fixture tests for the 7 agent prompts
- `test/paperclip-bridges.test.mjs` — mocked API tests for HeyGen, ElevenLabs, Descript

Run: `pnpm test paperclip`

## Secrets, never committed

The Terraform creates an SSM Parameter Store namespace at `/knowtation/paperclip/*`. Every secret lives there:

- `/knowtation/paperclip/DEEPINFRA_API_KEY`
- `/knowtation/paperclip/HEYGEN_API_KEY`
- `/knowtation/paperclip/HEYGEN_AVATAR_ID`
- `/knowtation/paperclip/HEYGEN_VOICE_ID`
- `/knowtation/paperclip/ELEVENLABS_API_KEY`
- `/knowtation/paperclip/ELEVENLABS_VOICE_ID`
- `/knowtation/paperclip/DESCRIPT_API_KEY`
- `/knowtation/paperclip/DESCRIPT_BORNFREE_PROJECT_ID`
- `/knowtation/paperclip/DESCRIPT_STOREFREE_PROJECT_ID`
- `/knowtation/paperclip/DESCRIPT_KNOWTATION_PROJECT_ID`
- `/knowtation/paperclip/KNOWTATION_HUB_URL`
- `/knowtation/paperclip/KNOWTATION_HUB_JWT`
- `/knowtation/paperclip/KNOWTATION_VAULT_ID`

The EC2 instance has an IAM role with read-only access to this namespace. Paperclip's systemd service reads the parameters at startup and re-reads them every 60 seconds (so JWT rotation is hot — no restart required).

## Costs

| Resource | Monthly cost |
|----------|--------------|
| EC2 t3.medium (2 vCPU, 4 GB RAM) | $30.37 |
| EBS gp3 30 GB | $2.40 |
| SSM Parameter Store (Standard) | $0.00 (free tier covers 10k params) |
| Data egress | <$1 (mostly inbound webhook traffic) |
| **Total AWS** | **~$33/mo** |

This is the orchestration layer only. The video factory's full bill including all SaaS is ~$140-195/mo (see runbook for breakdown).
