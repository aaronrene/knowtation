# Overseer handover

<!-- GENERATED FROM CANONICAL FLOW flow_overseer_handover@0.2.0 (generator v1) — DO NOT EDIT; regenerate via knowtation flow project -->

Docs-first handover of the cross-repo overseer role: snapshot truth per repo, update the durable docs (ROADMAP snapshot, next-session plan, coordination doc), then regenerate the living handover block as a projection of them.

## Step 1

- **Owned job:** Snapshot truth per repo, confirmed via muse -C (not ambient).
- **Instruction:** Run muse -C &lt;abs path&gt; status and log for each repo (Scooling, Knowtation, MuseHub) and capture branch, HEAD sha, and dirty state.
- **Trigger:** Run when a chat is getting long, a chat switch is needed, or a session ends with multi-repo state in flight.
- **When not to run:** Skip if no multi-repo state is in flight and no handover is needed.
- **Requires:** vault_scope:project, tool:muse_cli
- **Boundaries:**
  - Always target each repo with muse -C &lt;absolute-path&gt; — a bare muse can report an ambient repo
  - Read only — do not commit or checkout during the snapshot
  - No secrets in captured output
- **Skill refs:** cli:muse -C &lt;abs-repo-path&gt; status, cli:muse -C &lt;abs-repo-path&gt; log
- **Outputs:** per_repo_state:text
- **Output shape:** A per-repo line for each repo with real branch, HEAD sha, and dirty flag, each confirmed via -C.
- **Verification:** artifact_exists — Each repo is confirmed via -C (not ambient) and every repo line carries a real branch and sha. (evidence required: yes)

## Step 2

- **Owned job:** Record the current step, next action, and open gates/blockers.
- **Instruction:** Write down the current initiative step, the unambiguous next action, and any open gates or blockers.
- **Trigger:** Run after per-repo truth is captured.
- **When not to run:** Skip if the next action and gates are already recorded and unchanged.
- **Requires:** vault_scope:project
- **Boundaries:**
  - State the next action so it needs no chat history to interpret
- **Inputs:** per_repo_state (from flow_overseer_handover#1.outputs.per_repo_state)
- **Outputs:** step_and_gates:text
- **Output shape:** A current-step line, a next-action line, and an open-gates/blockers list.
- **Verification:** human_review — The next action is unambiguous. (evidence required: yes)

## Step 3

- **Owned job:** List the boundaries and the cross-repo wiring touched this session.
- **Instruction:** Enumerate the boundaries to honor and the cross-repo wiring touched this session.
- **Trigger:** Run after the step and gates are recorded.
- **When not to run:** Skip if no cross-repo wiring was touched and boundaries are already listed.
- **Requires:** vault_scope:project
- **Boundaries:**
  - Boundaries are stated explicitly, not assumed
- **Outputs:** boundaries_and_wiring:text
- **Output shape:** An explicit boundaries list and a cross-repo wiring list for the session.
- **Verification:** human_review — Boundaries are explicit and the cross-repo wiring touched is listed. (evidence required: yes)

## Step 4

- **Owned job:** Update the durable docs FIRST.
- **Instruction:** Update the ROADMAP snapshot, the next-session plan, and the coordination doc so they match reality before any block is written.
- **Trigger:** Run after truth, step/gates, and boundaries are captured.
- **When not to run:** Never skip when handing off — docs-first ordering is mandatory.
- **Requires:** vault_scope:project, file:docs/ROADMAP.md, file:docs/PRODUCT-SURFACES-NEXT-SESSION-PLAN.md, file:docs/CROSS-REPO-COORDINATION.md
- **Boundaries:**
  - Update durable docs before regenerating any handover block
  - Docs are the source of truth, the block is a projection of them
- **Outputs:** docs_update_ref:string
- **Output shape:** Updated ROADMAP snapshot, next-session plan, and coordination doc reflecting reality.
- **Verification:** artifact_exists — The durable docs are updated and match reality before any block is written. (evidence required: yes)

## Step 5

- **Owned job:** Regenerate the handover block into the living file from the now-current docs.
- **Instruction:** Overwrite docs/OVERSEER-HANDOVER.md with a block regenerated from the updated durable docs, not from memory.
- **Trigger:** Run only after the durable docs are updated.
- **When not to run:** Skip if the docs have not yet been updated this handover.
- **Requires:** vault_scope:project, file:docs/OVERSEER-HANDOVER.md
- **Boundaries:**
  - The block is a projection of the docs — never hand-written ahead of them
  - No secrets in the block
- **Inputs:** docs_update_ref (from flow_overseer_handover#4.outputs.docs_update_ref)
- **Outputs:** handover_block_ref:string
- **Output shape:** An overwritten docs/OVERSEER-HANDOVER.md whose block matches the durable docs.
- **Verification:** artifact_exists — The living file is overwritten and its block matches the docs, not memory. (evidence required: yes)

## Step 6

- **Owned job:** Emit the block as the first message of the next chat.
- **Instruction:** Paste the regenerated handover block as the first message of the new chat so the overseer role resumes with no prior history.
- **Trigger:** Run once the living file holds the current block.
- **When not to run:** Skip if no new chat is being started.
- **Requires:** vault_scope:project, file:docs/OVERSEER-HANDOVER.md
- **Boundaries:**
  - Emit only the projected block — do not add scope beyond the durable docs
- **Inputs:** handover_block_ref (from flow_overseer_handover#5.outputs.handover_block_ref)
- **Outputs:** emitted_block:text
- **Output shape:** The handover block, emitted as the first message of the next chat.
- **Verification:** human_review — A new overseer can resume from the emitted block with no prior chat history. (evidence required: yes)
