# Muse commit pilot — acceptance evidence (Phase 7A, Step 7A-14)

Status: **PASS — canonical → projection → Muse commit loop proven end-to-end** on our own
repo-guidance Flow `flow_overseer_handover`, extending the 7A-12 anti-drift demo with **Muse as the
durable write surface**.

Reproducible: re-run [`run-pilot.sh`](run-pilot.sh). Evidence artifacts and transcript regenerate;
the pilot workspace is Muse-committed on `feat/flow-projection-pilot`.

- **Repo / branch / Muse:** Knowtation `feat/flow-projection-pilot` @ `a5210fb7` (7A-14 evidence +
  tests; pilot workspace commits `59a63f12`→`b0f9cf47`; dependency 7A-12 @ `aec0c771`).
- **Dependencies verified:** 7A-10b store + 7A-11b projection generator (read/project surfaces);
  Scooling 7A-13 loopback read wire @ `0311332c` (posture OFF — not flipped in this step).
- **Generator:** `PROJECTION_GENERATOR_VERSION = 1`; harnesses `cursor_rule`, `cli_runbook`.
- **Contract:** `docs/FLOW-PROJECTION-GENERATOR-CONTRACT-7A-11.md` §10 + Muse commit as write surface.

## Simple summary (plain language)

We proved the full loop: the procedure lives in one canonical place (Knowtation Flow), we print it
into the formats tools need (projections), and we save those printouts durably using **Muse commits**
—not by hand-editing files. When the procedure changed once, we reprinted and Muse-committed again;
the only differences were exactly what changed in the procedure. Hand-scribbling on a saved printout
still gets caught and rejected.

## Technical summary

Using throwaway store + copied demo starters (`../7A-12/demo-starters/v1`,`/v2`), the driver:

1. Generated `cli_runbook` + `cursor_rule` projections into `pilot-workspace/`.
2. **Muse-committed** baseline @ v0.1.0 (`59a63f12`).
3. Seeded canonical v0.2.0, regenerated, captured clean anti-drift diffs (marker + one summary line).
4. **Muse-committed** update @ v0.2.0 (`b0f9cf47`); `muse diff` between commits shows 2 modified
   pilot-workspace files only.
5. Re-ran 7A-12 §10 gates: delete+regenerate byte-identical; hand-edit drift exit 1; staleness exit 1;
   honest fidelity.

**Scope fence honored:** real `AGENTS.md`, `.cursor/rules/`, `flows/starter/`, live store untouched;
`FLOW_LIVE_READ_AUTHORIZED` stays `false`; no flow run (7A-L3); no MuseHub enrichment (7A-L5).

---

## Acceptance criteria — results

| # | Criterion | Result |
| --- | --- | --- |
| 1 | Generate projections from canonical Flow into pilot workspace | ✅ both harnesses @ v0.1.0 and v0.2.0 |
| 2 | **Muse commit** baseline artifacts on feature branch | ✅ `59a63f12` |
| 3 | Edit canonical → regenerate → clean diff (only canonical change) | ✅ [`overseer.runbook.v1-to-v2.diff`](artifacts/overseer.runbook.v1-to-v2.diff), [`overseer.cursor.v1-to-v2.diff`](artifacts/overseer.cursor.v1-to-v2.diff) |
| 4 | **Muse commit** updated artifacts; record before/after SHAs | ✅ before `aec0c771`, after `b0f9cf47`; [`muse-commit.v1-to-v2.diff`](artifacts/muse-commit.v1-to-v2.diff) |
| 5 | Delete loses nothing | ✅ IDENTICAL after delete+regenerate |
| 6 | Hand-edit caught | ✅ `drift: true (edited)`, exit 1 |
| 7 | Staleness surfaces | ✅ `stale: true`, exit 1 |
| 8 | No secrets in rendered bytes | ✅ scan clean |

Full transcript: [`artifacts/transcript.txt`](artifacts/transcript.txt).

---

## Muse commit chain (the new proof vs 7A-12)

| Commit | SHA | What |
| --- | --- | --- |
| Pre-pilot (7A-12) | `aec0c771` | Anti-drift demo evidence |
| Pilot baseline v0.1.0 | `59a63f12` | First Muse commit of generated pilot-workspace |
| Pilot update v0.2.0 | `b0f9cf47` | Second Muse commit after canonical bump |

`muse diff 59a63f12 b0f9cf47 --path pilot-workspace` → 2 modified files, marker version + summary line only.

---

## Reproduce

```bash
cd ~/knowtation
bash docs/evidence/7A-14/run-pilot.sh
```

**Note:** Re-running creates **new** Muse commits on the current branch. For CI/tests, use the frozen
artifacts under `artifacts/` and `pilot-workspace/` — do not re-run the driver in CI unless on a
throwaway branch.

## Files

| Path | What |
| --- | --- |
| `run-pilot.sh` | Reproducible driver (generate → muse commit → regenerate → muse commit) |
| `pilot-workspace/` | Muse-committed projection targets (sandbox — not real AGENTS.md) |
| `artifacts/` | Transcript, anti-drift diffs, muse SHA records, version snapshots |
| `../7A-12/demo-starters/` | Canonical bundles v0.1.0 / v0.2.0 (reused, not duplicated) |

## Tests

Seven-tier suite: `test/flow-muse-commit-pilot-*.test.mjs` + validators in
`lib/flow/muse-commit-pilot-evidence.mjs`.

## Next step

**7A-L1** (Thinking) — Live Flow authoring write-back via Knowtation proposals. Separate authorization
gate; not started here.
