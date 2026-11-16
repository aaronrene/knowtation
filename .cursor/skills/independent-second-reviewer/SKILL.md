---
name: independent-second-reviewer
description: >-
  Independent second reviewer — second chat / separate verifier records an
  independent_second_review ledger pass before Auto ROADMAP DONE when ISR is
  warn or require. Kit records/gates only; does not run another model.
---

# Independent second reviewer

Invoke: **`/independent-second-reviewer`**.

The kit records and gates the second verdict. It does not run another model.
Open a new chat or a separate verifier runtime; then use the CLI below.

Portable paste (any host): `docs/INDEPENDENT-SECOND-REVIEWER.md`.

## Process (frozen)

1. Confirm this session is **not** the builder session. If it is, stop and tell
   the operator to open a second chat. Do **not** append a pass. Do **not**
   write ROADMAP **DONE**.
2. Re-run `/build-verification-review` **V1–V8 only** against the frozen spec +
   diff (implementation honesty). **V9 is not part of this step** — it is the
   DONE-unlock check and cannot be satisfied before the append in step 3.
3. On V1–V8 `pass`, append `independent_second_review` with `isr_verdict: pass`,
   this session as `actor_session_id`, and the builder nonce as
   `producer_session_id`:

   ```bash
   ok ledger append --kind independent_second_review --stdin <<'EOF'
   {
     "kind": "independent_second_review",
     "actor_role": "verifier",
     "actor_session_id": "<THIS_CHAT_SESSION_ID>",
     "phase_id": "<PHASE_ID>",
     "frozen_spec": "<FROZEN_SPEC_PATH>",
     "round": 1,
     "isr_verdict": "pass",
     "producer_session_id": "<BUILDER_PRODUCER_SESSION_NONCE>"
   }
   EOF
   ```

4. When `honesty.require_verification_evidence` is `warn` or `require`, also
   append / confirm Mode B `verification_evidence` (V8) **before** claiming
   DONE. ISR does not replace Mode B.
5. ROADMAP **DONE** is allowed only after step 3 (and step 4 when it applies).
   That is when V9 holds if ISR is `warn` or `require`.
6. When ISR config is `off`, this skill is advisory; Mode D / status do not fail.
7. `findings` / `blocked` on V1–V8: do not append `isr_verdict: pass`. A
   `findings` ISR append is allowed but not required.
8. Never merge to `main`. Never call a model via the kit CLI for this gate
   (`ok review --freeze` remains the K5 spec reviewer, not the ISR dispatcher).

## Check

```bash
ok honesty-status --independent-second-review PHASE_ID \
  [--producer-session BUILDER_NONCE] [--frozen-spec PATH] [--json]
```
