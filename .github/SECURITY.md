# Security Policy

## Supported Versions

Security fixes are applied to the latest commit on the `main` branch. No separate release branches are maintained at this time.

| Version | Supported |
|---------|-----------|
| `main` (latest) | Yes |
| Older commits | No |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Report security issues privately using one of these methods:

1. **GitHub Security Advisories (preferred):** Use the [Report a vulnerability](../../security/advisories/new) link on the Security tab of this repository. GitHub will keep the report private until a fix is coordinated.
2. **Email:** Send details to the repository owner through the contact information on the GitHub profile.

### What to include

- Description of the vulnerability and affected component(s)
- Steps to reproduce (or a proof-of-concept if available)
- Potential impact (data exposure, authentication bypass, privilege escalation, etc.)
- Any suggested fix if you have one

### Response timeline

- **Acknowledgement:** within 3 business days
- **Initial assessment:** within 7 business days
- **Fix and coordinated disclosure:** timeline depends on severity; critical issues are prioritized

## Scope

In scope:
- `hub/gateway/` — OAuth, JWT, image proxy, billing
- `hub/bridge/` — GitHub integration, vault sync, team roles
- `hub/icp/` — ICP canister (Motoko)
- `lib/` — core library (search, memory, importers, AIR)
- `mcp/` — MCP server
- `cli/` — CLI
- `web/hub/` — Hub frontend

Out of scope:
- Self-hosted deployments that use default or weak secrets in `config/local.yaml` or `.env`
- Vulnerabilities that require physical access to the server
- Denial-of-service attacks against self-hosted instances
- Third-party services (GitHub OAuth, Stripe, Netlify, Internet Computer)

## Security hardening

This codebase has completed a 4-phase pre-launch security audit (Phases 0–3). See [`docs/SECURITY-AUDIT-PLAN.md`](../docs/SECURITY-AUDIT-PLAN.md) for the full remediation record.
