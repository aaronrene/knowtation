# Hosted platform backup and disaster recovery (roadmap)

**Status:** **Partially implemented.** **Users** can back up vault content via **Connect GitHub** and **Back up now** (bridge → Git export). **Operators** use **[ICP canister snapshots](https://docs.internetcomputer.org/building-apps/canister-management/snapshots)** for **full hub + attestation** state (see [ICP-CANISTER-SNAPSHOT-RUNBOOK.md](./ICP-CANISTER-SNAPSHOT-RUNBOOK.md), `npm run canister:snapshot-backup`). Separately, **`npm run canister:export-backup`** and [`.github/workflows/canister-export-backup.yml`](../.github/workflows/canister-export-backup.yml) ([DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §6) perform **HTTP logical export** for **one configured `X-User-Id` partition** — not a substitute for snapshots. **Still open:** admin HTTP export of **all** tenants, automatic restore from logical JSON, bridge vector blobs, billing blobs — see §2–§3.

**Related:** [OPERATOR-BACKUP.md](./OPERATOR-BACKUP.md) (two pillars: snapshots + daily full logical export), [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md), [ICP-CANISTER-SNAPSHOT-AUTOMATION.md](./ICP-CANISTER-SNAPSHOT-AUTOMATION.md), [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md) (checklist §4), [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md), [ICP-GITHUB-BRIDGE.md](./ICP-GITHUB-BRIDGE.md).

---

## 1. What user GitHub backup does and does not do

| Layer | User GitHub backup | Platform backup (this doc) |
|-------|--------------------|----------------------------|
| **Notes + proposals in canister** | **Back up now:** notes as Markdown + proposals in **`.knowtation/backup/v1/snapshot.json`**. | **Full state:** [ICP snapshots](./ICP-CANISTER-SNAPSHOT-RUNBOOK.md) (hub + attestation). **Logical sample:** HTTP export §6 ([DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md)) — one partition only. |
| **Bridge index (sqlite-vec)** | Not the same as vault files; re-buildable via **Re-index** | Optional: archive vector DB blobs per policy |
| **Gateway billing / roles blobs** | Not in user repo | Gateway/Netlify Blob or file store per deploy docs |

**Takeaway:** User backup is essential for **portability**; platform backup is essential for **continuity** if the canister or subnet data is corrupted, migrated wrong, or needs point-in-time recovery.

---

## 2. Canister state (context for backup scope)

- Notes and proposals live in **Motoko stable memory** (see [hub/icp/src/hub/main.mo](../hub/icp/src/hub/main.mo), [Migration.mo](../hub/icp/src/hub/Migration.mo)).
- **DELETE** removes the note from the in-memory vault map and persists with **`saveStable()`** — there is **no** separate “trash” or tombstone folder in current code; deleted means **removed from stable storage** for that path key (aside from normal ICP/stable-memory retention behavior described in ICP documentation for upgrades and garbage collection).

---

## 3. Future implementation directions (no commitment to order)

1. **Full canister snapshots (ICP-native)** — **Runbook + script:** [ICP-CANISTER-SNAPSHOT-RUNBOOK.md](./ICP-CANISTER-SNAPSHOT-RUNBOOK.md), [`scripts/icp-canister-snapshot-backup.sh`](../scripts/icp-canister-snapshot-backup.sh). Controller-operated; optional `snapshot download` for off-chain archives.
2. **Periodic logical export (HTTP)** — **All tenants:** [`scripts/canister-operator-full-export.mjs`](../scripts/canister-operator-full-export.mjs) + [`GET /api/v1/operator/export`](../docs/HUB-API.md) + [`.github/workflows/canister-operator-full-export.yml`](../.github/workflows/canister-operator-full-export.yml) (see [OPERATOR-BACKUP.md](./OPERATOR-BACKUP.md)). **Single partition (smoke):** [`scripts/canister-export-backup.mjs`](../scripts/canister-export-backup.mjs) + scheduled HTTP vault export workflow. Optional **AES-GCM** and **S3** for both. **Still open:** automated **restore** from full-export JSON, Arweave upload.
3. **Upgrade discipline** — Preflight scripts already exist (`npm run canister:preflight`, `canister:verify-migration`); extend runbooks to require a **snapshot** (or logical export checkpoint) before mainnet upgrades when data volume is non-trivial.
4. **Key custody** — Separate **deployment / upgrade keys** from **day-to-day operator** logins; prefer **hardware-backed** key storage (e.g. encrypted USB/HSM-style devices — products such as **Apricorn**-style hardware-encrypted drives are one pattern teams use for **offline controller secrets**) so break-glass credentials are not only on laptops or CI.
5. **Restore drill** — At least annually: restore a **non-production** canister or fixture from backup and verify note counts and hashes. Checklist: [ICP-CANISTER-SNAPSHOT-DRILL-CHECKLIST.md](./ICP-CANISTER-SNAPSHOT-DRILL-CHECKLIST.md).

**Operational detail** (exact key lists, bucket names, controller principals) belongs in **private** runbooks — e.g. a copy under **`development/`** (gitignored in this repo per [.gitignore](../.gitignore)) or a secure team vault — **not** in this public doc.

---

## 4. Billing and storage monitoring (link)

Per-user **canister byte** quotas are **not** the primary sold unit in [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md) v1 (**indexing tokens** are). **Storage** still affects **ICP cycles** (hosting cost). When product needs **tier caps** or **usage dashboards** for stable memory growth, extend [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md) §7 and gateway metrics — see revision log below.

---

## 5. Revision log

| Date | Change |
|------|--------|
| 2026-03-27 | Initial roadmap: user vs platform backup, canister scope, future export + key custody, pointer to private runbooks. |
| 2026-04-07 | Daily export script + Actions workflow + DEPLOY-HOSTED §6; roadmap status updated to partially implemented. |
| 2026-04-08 | Hosted **Back up now** includes full proposals in `.knowtation/backup/v1/snapshot.json` (bridge); scope filter parity for proposals. |
| 2026-04-08 | Operator export v2: notes + proposals in one JSON; AES-GCM + optional S3 (`@aws-sdk/client-s3`). |
| 2026-04-09 | ICP **canister snapshot** runbook + helper script; DEPLOY-HOSTED §6 clarified vs full backup; automation decision doc. |
| 2026-04-09 | **Operator full export:** Motoko `GET /api/v1/operator/export` + `admin_set_operator_export_secret`; `canister-operator-full-export` script + daily workflow; [OPERATOR-BACKUP.md](./OPERATOR-BACKUP.md). |
