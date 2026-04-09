# ICP canister snapshot backup and rollback (operator)

**Audience:** Hosted operators with **controller** access to Knowtation **hub** and **attestation** canisters on mainnet.

**This is full canister state** (Wasm + heap + stable memory), not the HTTP “export one user vault” path. For the latter, see [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §6 and [`scripts/canister-export-backup.mjs`](../scripts/canister-export-backup.mjs).

**Official reference:** [Canister snapshots | Internet Computer](https://docs.internetcomputer.org/building-apps/canister-management/snapshots), [dfx canister snapshot](https://docs.internetcomputer.org/building-apps/developer-tools/dfx/dfx-canister).

---

## Prerequisites

1. **dfx** with snapshot support: DFINITY documents snapshots from **dfx 0.23.0+**; **snapshot download/upload** require a dfx version that includes those subcommands (see `dfx canister snapshot --help`). Run `dfx --version`.
2. **Identity:** `dfx identity use <controller>` — the identity must be a **controller** of both canisters. Custody: [APRICORN-KNOWTATION-BACKUP-CONTROLLERS.md](./APRICORN-KNOWTATION-BACKUP-CONTROLLERS.md).
3. **Project context:** Commands below assume `cd hub/icp` and [`canister_ids.json`](../hub/icp/canister_ids.json) matches mainnet ids for `hub` and `attestation`.
4. **Maintenance window:** Creating or loading a snapshot requires **`dfx canister stop`** first. While stopped, the canister does not serve traffic — plan **downtime** for **hub** especially.

---

## Limits (ICP)

- **At most 10 snapshots** stored **on subnet** per canister. Use `dfx canister snapshot list` and `dfx canister snapshot delete` or `snapshot create --replace <id>` before hitting the cap.
- **Load** replaces current code **and** data with the snapshot; **anything after the snapshot is lost** for that canister.

---

## Backup procedure (per canister)

Default order: **`hub`** then **`attestation`** (hub is the primary API surface; attestation is separate state).

For each `<name>` in `hub`, `attestation`, with `--network ic`:

```bash
cd hub/icp

dfx canister stop <name> --network ic
dfx canister snapshot create <name> --network ic
dfx canister start <name> --network ic
```

Note the **Snapshot ID** from the `create` output (or run `dfx canister snapshot list <name> --network ic` immediately after).

### Optional: off-chain copy

After create, download snapshot bytes to disk (empty directory; use a fresh folder per snapshot):

```bash
dfx canister snapshot download <name> <SNAPSHOT_ID> --dir /path/to/empty-dir --network ic
```

Archive the directory (encrypted disk, S3 with SSE-KMS, etc.). **Do not commit** snapshot dirs or PEMs to git.

To re-upload a downloaded snapshot to the same or another canister (advanced / migration), see `dfx canister snapshot upload` in the dfx reference.

---

## Rollback (load snapshot)

**Warning:** Stops service; **destroys all state newer than the snapshot** when load completes.

```bash
cd hub/icp

dfx canister stop <name> --network ic
dfx canister snapshot load <name> <SNAPSHOT_ID> --network ic
dfx canister start <name> --network ic
```

Repeat only for canisters you intend to roll back. Prefer practicing on a **non-production** canister first. Printable template: [ICP-CANISTER-SNAPSHOT-DRILL-CHECKLIST.md](./ICP-CANISTER-SNAPSHOT-DRILL-CHECKLIST.md).

---

## Scripted helper

From repo root:

```bash
npm run canister:snapshot-backup -- --help
```

Uses the same stop → create → start flow; optional `--download-dir` for post-create downloads. Does **not** store controller PEMs; uses your current `dfx` identity.

---

## Restore drill checklist

Use [ICP-CANISTER-SNAPSHOT-DRILL-CHECKLIST.md](./ICP-CANISTER-SNAPSHOT-DRILL-CHECKLIST.md). Copy the filled table to private storage only.

---

## Related

- [ICP-CANISTER-SNAPSHOT-AUTOMATION.md](./ICP-CANISTER-SNAPSHOT-AUTOMATION.md) — CI vs manual controller custody.
- [ICP-CANISTER-SNAPSHOT-DRILL-CHECKLIST.md](./ICP-CANISTER-SNAPSHOT-DRILL-CHECKLIST.md) — Restore drill template (copy to private storage when filled).
- [HOSTED-PLATFORM-BACKUP-ROADMAP.md](./HOSTED-PLATFORM-BACKUP-ROADMAP.md) — User GitHub backup vs operator tooling.
