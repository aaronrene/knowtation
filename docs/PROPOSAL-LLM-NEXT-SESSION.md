# Next session: proposal LLM (Enrich + review hints)

Use this doc so the next chat or PR does not lose context. Branch for doc fixes: **`feat/hub-proposal-llm-ux`**.

---

## Plan A vs Plan B (simple terms)

| | **Plan A — LLM UX first** | **Plan B — Hosted Enrich end-to-end** |
|---|-----------------------------|----------------------------------------|
| **Goal** | Make the **product match reality**: correct docs, then small **Hub UI** fixes so people who **evaluate** proposals can use **Enrich** where it already works (self-hosted), and optional **“regenerate hints”** later. | Add **Motoko + gateway** so **Enrich** works **on hosted**: store `assistant_notes` / labels on the canister and a gateway route that calls the LLM then updates the canister. |
| **Enrich** | Still **self-hosted only** for the actual API (`POST …/enrich` in `hub/server.mjs`). UI shows the button to **evaluators** too, not only users who **may approve**. | **Hosted** users get Enrich: bigger change (migration, deploy, tests). |
| **Review hints** | Docs + optional polish (manual regen button). **Hosted hints already ship** via `hub/gateway/proposal-review-hints-async.mjs` when env is set. | Not the focus; hints already work on gateway. |
| **Effort** | Small, fast **win**. | Larger **second PR** when you want hosted parity for Enrich. |

**Recommendation:** **Plan A first** — same as “quick win,” but it is not a hack: it aligns docs and permissions with how the backend actually works, then you can do Plan B when you are ready for canister work and deploys.

---

## Documents and code to keep in mind

| Topic | Path |
|--------|------|
| Feature overview (review hints vs Enrich) | [HUB-PROPOSAL-LLM-FEATURES.md](./HUB-PROPOSAL-LLM-FEATURES.md) |
| This handoff | [PROPOSAL-LLM-NEXT-SESSION.md](./PROPOSAL-LLM-NEXT-SESSION.md) |
| Roadmap / build status | [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) |
| Proposal lifecycle / evaluation | [PROPOSAL-LIFECYCLE.md](./PROPOSAL-LIFECYCLE.md) |
| Hosted deploy env | [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) |
| Gateway | `hub/gateway/server.mjs`, `hub/gateway/proposal-review-hints-async.mjs` |
| Self-hosted Enrich | `hub/server.mjs` (`…/enrich`) |
| Hub UI (Enrich button ~4812) | `web/hub/hub.js` — today gated with **`canApprove && __hubProposalEnrich && hubUserCanWriteNotes()`**; Plan A: use **`canEvaluate`** (or equivalent) instead of **`canApprove`** for showing Enrich |
| Canister proposal shape | `hub/icp/src/hub/main.mo`, `hub/icp/src/hub/Migration.mo` — **review_hints** exist; **no** enrich/assistant fields until Plan B |

---

## Done on branch `feat/hub-proposal-llm-ux` (docs)

- [x] **HUB-PROPOSAL-LLM-FEATURES.md** — hosted review hints described correctly (gateway async job + env + deploy note).
- [x] **hub/gateway/README.md** — review hints on gateway; Enrich still Node Hub until Plan B.

---

## Remaining work (Plan A — implement in code next session)

1. **`web/hub/hub.js`** — Show **Enrich (AI)** when **`canEvaluate`** (admin or evaluator) and **`window.__hubProposalEnrich`** and **`hubUserCanWriteNotes()`**, not only when **`canApprove`**. Hosted users will still see the button but may get a clear failure until Plan B unless you hide Enrich on hosted until then (product choice).
2. **Optional:** **Regenerate review hints** — gateway + self-hosted endpoint + small button; rate-limit / abuse considerations.
3. **`npm test`** after changes.
4. If gateway env docs change, touch **DEPLOY-HOSTED.md**.

---

## Plan B (later checklist)

- Extend **`ProposalRecord`** / migration for enrich fields; canister **POST** or internal update path.
- Gateway **`POST …/enrich`** (or dedicated route) → LLM → canister write.
- Hub client: same **`enrichProposal`** flow against gateway on hosted.
- Upgrade + deploy notes; tests.

---

## Paste-ready prompt for the next Cursor session

```text
Continue Knowtation Hub proposal LLM work on branch feat/hub-proposal-llm-ux (already has doc commits; pull/rebase if needed).

Decision: Plan A first — doc accuracy (done on branch) + Hub UX: show Enrich for users who can evaluate (canEvaluate), not only canApprove, when proposal_enrich_enabled and hubUserCanWriteNotes(). Code: web/hub/hub.js ~4812.

Defer Plan B (hosted Enrich / canister assistant fields) until a dedicated PR.

Optional follow-up: POST to regenerate review hints + UI button; npm test; DEPLOY-HOSTED if env changes.

Read docs/PROPOSAL-LLM-NEXT-SESSION.md, docs/HUB-PROPOSAL-LLM-FEATURES.md, hub/gateway/proposal-review-hints-async.mjs, hub/server.mjs enrich route.
```

---

## Security and ops (beginner-friendly, industry-aligned)

- **LLM output is not authorization** — hints and Enrich are **advisory**; humans still approve/discard.
- **PII and secrets** — proposal **body** may be sent to the model; avoid logging full bodies in production; disclose in policy if needed.
- **Cost and abuse** — OpenAI calls on every proposal (hints) or on demand (Enrich) cost money; consider **per-user caps** or **admin-only** Enrich on large teams.
- **Timeouts** — serverless gateways have tight limits; long models may need **async jobs** + polling (hints already fire-and-forget with `setImmediate`).
- **Never commit** `.env`, API keys, or private URLs; verify before push.
