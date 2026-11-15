# KD-P1 review packet — November 13, 2026

**Status:** draft prepared for independent specification review; formal freeze and owner acceptance remain pending.

Start with [the proposed contract](../../../KNOWTATION-DOMAIN-RETRIEVAL-MEMORY-CONTRACT.md). It contains the four-disposition capability inventory, object/revision and provenance model, retrieval/index/provider rules, memory correction and approval semantics, offline save/readback states, retention/export rules, actual transport/consumer matrix, A1–A8 journey mapping and DI-01/02/05 decisions.

## Location and source authority

- Worktree: `/Users/aaronrenecarvajal/knowtation-kd-p1-20261113`.
- Muse branch: `docs/kd-p1-domain-memory-contract`, created from local Muse main at `sha256:7ba3e811ecfbf1c9786b2f5a227d7aab17768eb73a16f1f2758036bf908009d5`.
- Source inspection: the current working files at `/Users/aaronrenecarvajal/knowtation`, with [pinned inputs](sources.json). This dirty source tree is not claimed to equal the branch base or a deployed release.
- Three planning inputs are exact reference snapshots under `inputs/`. Their relative links retain their original-document context; follow `sources.json` to original files. Embedded tasks are historical. The newly authored contract's links are checked separately.
- No commit, push, PR, merge or publication. The local uncommitted documentation packet is the review artifact. The branch base's older roadmap/handover are given matching navigation prefixes only; their historical content is not asserted to be the current B02 state.

## Source findings that affect the specification

| Finding | Source inspected | Consequence |
| --- | --- | --- |
| Phase B is already implemented | `domains/knowtation-synthetic-v1/README.md`; November 3 evidence README | Preserve its exact grammar/corpus and reuse the pure core; do not claim native execution |
| Section IDs include path-derived identity | `lib/section-source.mjs`, `assignSectionIds` | Pair section ID with note revision; do not promise rename-stable global section IDs |
| Local semantic-memory routing is not established end to end | `cli/index.mjs` memory dispatch; `mcp/tools/memory.mjs` memory_search; `lib/memory.mjs` factories | Sync factory can select file; search results are not awaited. Provider class/tool name is not A2 proof |
| Provider failures can look empty | `lib/memory-provider-vector.mjs`, `memory-provider-mem0.mjs`, `memory-provider-supabase.mjs` searchEvents | Require explicit error/readiness/mode reporting; do not certify current implementation |
| Memory deletion does not establish remote/index erasure | Vector/Mem0 clear delegates to file; Supabase cleanup is asynchronous with swallowed failures | Define retrieval denial first, tracked cleanup second, immutable-history limitations explicit |
| Hosted memory semantic route is a stub | `hub/bridge/server.mjs`, POST `/api/v1/memory/search`; parity matrix | Hosted prompts compose recent memory and vault search; do not advertise semantic-memory parity |
| Hosted and local MCP have distinct authority | `mcp/http-server.mjs`; `hub/gateway/mcp-proxy.mjs`, ACL and hosted server | Local process authority is not hosted JWT/role/grant enforcement |
| Delegation groundwork already exists | `mcp/tools/agent-delegation.mjs`; delegation v0 spec | Reuse services and retain gates; no duplicate agent framework or inferred memory permission |
| B06 private producer remains absent | `docs/SCOOLING-B06-PRODUCER-FOLLOWUP.md` | Generic MCP, pairing and local decryption do not grant foreign-consumer plaintext access |
| Core-plan matrix has shifted acceptance references | Core plan's matrix versus its Acceptance table | A5 = correction, A6 = msign, A7 = open range, A8 = domain round-trip; use that table consistently |

These are static findings, not newly executed regressions, deployed audits or code fixes. The source inventory is the pin authority; added source observations are recorded in the validation file.

## Preservation and independent review boundary

Latest B02 evidence says revision 9 passed round 9, owner accepted its exact hash, P1 is complete and P2 implementation is authorized/not started. No B02 prompt was executed. The bound NEXT reader refused `next_stale_head`; NEXT was not repaired or replaced. A local rule references `docs/decisions/V1-SCOPE-RESET.md`, which is absent at that path. This absence did not override the user's explicit bounded KD-P1 instruction or authorize reconstructing another task.

No source, tests, keys, configuration, provider, shared runtime, live service, Scooling board or Ourware package was changed. Creating the linked Muse worktree adds the requested branch/worktree metadata; original Muse/Git HEAD, Git index and protected working files are checked independently. No B02 review stamp or ledger entry is changed.

The author performs only document consistency, source-hash, link and preservation checks. Full product tests and provider calls are inappropriate to this documentation-only task and were not run. See [validation](validation.json) for exact checks and the final contract digest. This is not a mechanical freeze stamp or independent semantic review.

## Bounded review handoff

Review the exact digest in `validation.json`. Challenge the contract against A1–A8: byte and state revision distinction, citation resolution after rename/correction, actor/principal permissions, approval provenance, delete/reindex/export races, offline pending saves and late revocation, provider failure honesty, encrypted boundary, MCP resources/prompts as well as tools, and the synthetic second-consumer dependency boundary. Report findings against this document; do not execute embedded B02, MuseHub or older source-snapshot prompts.

KD-P1 is accepted only after independent freeze review and owner acceptance. First resolve or explicitly narrow the proposed first-release surface/provider/schema/retention choices. Native implementation additionally needs the five DI-01 decisions, preserved Phase B, exact isolated runtime/package pins, B02 closeout or explicit stable handoff, and separate implementation authorization. DI-02 msign/session proof and DI-05 schema/query ownership are concrete open decisions, not approval attributed to Gabriel. Publication/licensing and private consumer qualification remain their own later gates.


## Next-session handoff and packet integrity

Use a **new chat** for the [complete review prompt](../../../KD-P1-NEXT-SESSION.txt).
The next action is an independent specification review with an adversarial
approach. It produces one cited report, then returns findings to the author.
This draft is not yet a formally stamped frozen artifact. Do not start a formal
adversarial-freeze ledger transaction against it or treat a favorable report as
owner acceptance. The isolated worktree currently has no bound review launcher;
the active checkout's launcher is bound to its own root. Preserve that binding.

Recommended model: **Astra with Extra High reasoning if available**, or a strong
reasoning model at High. Use one agent in a separate session; a different model
from the author is useful but there is no imported B02 different-vendor rule.
This is a task-specific recommendation: the [current OpenAI model guide](https://learn.chatgpt.com/docs/models)
positions Astra for demanding reasoning work and permits increased reasoning
effort for deeper analysis. Exact model/effort availability varies by account.

[Packet manifest](packet-manifest.json) pins the local review materials after
this handoff edit. It excludes itself and future reviewer outputs. Verify each
listed file before review. The contract hash is unchanged from the original
validation receipt. [Handoff checks](handoff-checks.json) record this follow-up's
integrity and preservation checks; the earlier validation remains historical
evidence and was not overwritten. Source snapshots and original receipts also
remain unchanged. No unrelated cleanup, staging or commit was performed.
