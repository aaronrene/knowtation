# Deploy verification review skill

Use **before** marking a phase **DONE** in `{{docs.roadmap_path}}` / regenerating HANDOVER when the
session claims a **live deploy**, **production (or staging-as-production) rollout**, a public URL
is **"up" / "healthy" / "verified"**, or **"shipped"** meaning running **outside** the local repo
(not merely code merged to a feature branch). Invoke: **`/deploy-verification-review`**.

This is the **live-deploy sibling** of `/build-verification-review`. The kit still never deploys
and never HTTP-probes production — it only records and optionally gates operator-supplied
deploy/health claims (Mode C / `require_deploy_health`).

## Purpose

Catch ship/live-health dishonesty: "we shipped it" / "production is healthy" without a durable,
content-addressed `deploy_health` record on the honesty ledger (when honesty is enabled).

| Gate | When | Tool |
| --- | --- | --- |
| **Build verification** | Every Auto build DONE | `/build-verification-review` (mandatory; never waived) |
| **Deploy verification** | Ship / live-health claim present | **This skill** |
| **Mode C CI gate** | Opt-in `require_deploy_health: require` | `ok honesty-status --deploy-health PHASE_ID` |

## When to use

Invoke when **any** of these claims appear in the deliverable, handover, or ROADMAP row:

- live deploy / production (or staging-as-production) rollout
- public or customer-facing URL is "up" / "healthy" / "verified"
- "shipped" meaning running outside the local repo

**Non-triggers:** ordinary Auto builds that only claim code + tests + local CLI behavior (kit
governance phases, Track O ceremony without a live consumer probe) use
`/build-verification-review` alone. Track O `ok upgrade-regime` is a regime ceremony, not a
P-deploy trigger.

## Model

**Always `thinking-high`** — independent reviewer; preferably not the same session that claimed
the ship. Never Auto for this gate.

## Inputs (read all)

1. Frozen spec — must authorize a ship/live-health claim (D1)
2. Operator-supplied health-record bytes (or CI artifact) the verifier inspected
3. `{{docs.roadmap_path}}` / `{{docs.handover_path}}` — ship wording vs Mode C
4. Ledger (when `honesty.enabled`) — `verification_evidence` with ≥1 `deploy_health` artifact
5. Git / Muse diff — no kit-side deploy or production HTTP probe helpers

## Checklist (every item needs evidence)

| # | Check | Dishonesty signal |
| --- | --- | --- |
| D1 | Deploy/health claim is in scope for this phase (frozen spec authorizes a ship claim) | "Shipped" for a spec that forbids live probes / deploys |
| D2 | Operator-supplied health record exists on disk or in CI artifacts (bytes the verifier hashed) | Claim with no record file |
| D3 | Ledger entry (when `honesty.enabled`) is `verification_evidence` with `bv_verdict: pass` and ≥1 `deploy_health` artifact | Pass claim with only `test_output` / `screenshot` |
| D4 | `deploy_health.sha256` digests the **same** health-record bytes the verifier inspected | Hash of unrelated file |
| D5 | `deploy_health.ref` identifies the check (URL string, job id, env name) as opaque metadata — not fetched by the kit | Kit "proved" health by opening the URL itself |
| D6 | Health record is from **this** ship session (verifier cites session/time; no automated TTL) | Reusing last quarter's health JSON |
| D7 | No kit code path performs deploy or production HTTP probe as part of "verification" | Auto added `urllib.request.urlopen(prod)` under tools/ |
| D8 | ROADMAP/HANDOVER "shipped"/DONE wording matches Mode C (when honesty enabled + `require`) | DONE without matching ledger entry under `require` |

## Relationship to build-verification

1. `/build-verification-review` remains mandatory for every Auto build DONE.
2. When the build session claims deploy/health, BV V8 already requires a `deploy_health` artifact
   in the evidence entry — unchanged.
3. This skill is the **sibling gate for shipped/live claims**. It does **not** replace or waive
   `/build-verification-review`. If BV already passed and the only remaining claim is live health,
   a deploy-verification round is sufficient for that ship claim. Under `honesty.enabled: true`, a
   skill `pass` MUST append or confirm a Mode C–matching entry
   (`ok honesty-status --deploy-health …` under `require` exits `0`).
4. When `honesty.enabled: false`, ledger append is skipped; D1–D8 still require claims↔record
   honesty in the review text.
5. Hard stops unchanged: no merge to `{{vcs.git.main_branch}}` on `findings`/`blocked`; uncited
   findings invalid; no Tier-3 automation.

## Verdicts

| Verdict | Meaning | Next step |
| --- | --- | --- |
| `pass` | Ship/live-health claim honest; Mode C match when required | Allow DONE wording that asserts shipped/healthy |
| `findings` | Cited gaps | Fixer addresses citations only; **re-run this skill** |
| `blocked` | Escalating category or fundamental boundary violation | Human required |

Escalation categories: `security`, `irreversible`, `real_money`, `gates_tier3`.

## Loop (bounded)

- **Max rounds:** 5
- Reviewer → findings → fixer (cited lines only) → re-review until `pass` or stop
- Do **not** mark ship/DONE under `require` until `pass`

## Output format

```markdown
## Deploy verification — <phase-id> round <N>

**Verdict:** pass | findings | blocked
**Frozen spec:** <path>
**Health record:** <path or CI artifact id>
**Mode C:** matched_entry_hash=<…> | missing | honesty disabled

### Findings
| ID | Sev | path:line | Claim vs reality |
| --- | --- | --- | --- |
| DV1 | MAJOR | docs/HANDOVER.md:12 | Claims production healthy; no deploy_health artifact |

### Honest summary (only if pass)
One paragraph: what health record was hashed, what ref was recorded, and that the kit did not probe.
```

## CLI helpers (non-substitute)

```bash
./cli/ok honesty-status --deploy-health "<PHASE_ID>" [--frozen-spec PATH] --json
# exit 34 + missing_deploy_health when require_deploy_health: require and no Mode C match
```

## Hard stops

- Kit never deploys; never opens HTTP(S) to a production URL as verification
- `ref` is opaque — never fetched, never executed
- No merge to `{{vcs.git.main_branch}}` on `findings` or `blocked`
- Uncited findings invalid — re-review
- Do not waive `/build-verification-review` for Auto DONE
