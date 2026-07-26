# Side check — {{TOPIC}}

**Date:** {{DATE}}  
**Kind:** ad-hoc Check OK (not a roadmap lane)  
**Honesty:** same Freeze-Contract + build-verification path as roadmap phases

## Freeze-contract declaration

```yaml
phase: check-ok-{{SLUG}}
outputs:
  - id: side-check
    path: docs/reviews/{{DATE}}-{{SLUG}}.md
    frozen: true
frozen_inputs: []
```

## Scope

Describe the work under review: intent, files touched, fail-closed rules, and the
seven-tier test plan (unit, integration, e2e, stress, data-integrity, performance,
security).

## Ground-truth edge

Downstream Auto / implementation sessions may treat this document as ground truth for
the scoped work without re-deriving the contract. This is **not** a new `docs.lanes`
baton — promote to a lane only if the concern becomes durable.

## Test matrix (seven tiers)

| Tier | Expectation |
| --- | --- |
| unit | Core logic covered |
| integration | CLI / module seams covered |
| e2e | Full operator path covered |
| stress | Bounded / non-pathological under load |
| data-integrity | No silent corruption of declared state |
| performance | Completes within local budget |
| security | No secrets, path escape, or injection surfaces |

Every freeze-review finding MUST cite **file+line** (SPEC §6).

## Review record

| Round | Reviewer | Verdict | Resolution |
| --- | --- | --- | --- |
| — | — | pending | Template copied |
