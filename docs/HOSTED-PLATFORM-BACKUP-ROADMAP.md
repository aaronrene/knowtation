# Hosted platform backup and disaster recovery (roadmap)

**Status:** **Partially implemented.** **Users** can back up vault content via **Connect GitHub** and **Back up now** (bridge → Git export). **Operators** can run **`npm run canister:export-backup`** and the scheduled workflow in [`.github/workflows/canister-export-backup.yml`](../.github/workflows/canister-export-backup.yml) (see [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §6) for daily **note** JSON export per vault partition. **Not** yet covered here: full stable-memory dumps, automatic **proposal**-only archives, bridge vector blobs, billing blobs — see §2–§3.

**Related:** [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md), [HOSTED-STORAGE-BILLING-ROADMAP.md](./HOSTED-STORAGE-BILLING-ROADMAP.md) (checklist §4), [MULTI-VAULT-AND-SCOPED-ACCESS.md](./MULTI-VAULT-AND-SCOPED-ACCESS.md), [ICP-GITHUB-BRIDGE.md](./ICP-GITHUB-BRIDGE.md).

---

## 1. What user GitHub backup does and does not do

| Layer | User GitHub backup | Platform backup (this doc) |
|-------|--------------------|----------------------------|
| **Notes + proposals in canister** | Exported as files when the user runs backup/sync | Independent snapshot or export of **canister stable state** (or equivalent) |
| **Bridge index (sqlite-vec)** | Not the same as vault files; re-buildable via **Re-index** | Optional: archive vector DB blobs per policy |
| **Gateway billing / roles blobs** | Not in user repo | Gateway/Netlify Blob or file store per deploy docs |

**Takeaway:** User backup is essential for **portability**; platform backup is essential for **continuity** if the canister or subnet data is corrupted, migrated wrong, or needs point-in-time recovery.

---

## 2. Canister state (context for backup scope)

- Notes and proposals live in **Motoko stable memory** (see [hub/icp/src/hub/main.mo](../hub/icp/src/hub/main.mo), [Migration.mo](../hub/icp/src/hub/Migration.mo)).
- **DELETE** removes the note from the in-memory vault map and persists with **`saveStable()`** — there is **no** separate “trash” or tombstone folder in current code; deleted means **removed from stable storage** for that path key (aside from normal ICP/stable-memory retention behavior described in ICP documentation for upgrades and garbage collection).

---

## 3. Future implementation directions (no commitment to order)

1. **Periodic logical export** — **Done (v1):** [`scripts/canister-export-backup.sh`](../scripts/canister-export-backup.sh) + GitHub Actions schedule + artifacts. **Still open:** optional push to **encrypted** object storage (S3-compatible, etc.), **admin/export** for multi-user dumps without embedding a partition `X-User-Id` in CI, and export shapes that include **proposals** alongside notes in one file.
2. **Upgrade discipline** — Preflight scripts already exist (`npm run canister:preflight`, `canister:verify-migration`); extend runbooks to require a **snapshot or export checkpoint** before mainnet upgrades when data volume is non-trivial.
3. **Key custody** — Separate **deployment / upgrade keys** from **day-to-day operator** logins; prefer **hardware-backed** key storage (e.g. encrypted USB/HSM-style devices — products such as **Apricorn**-style hardware-encrypted drives are one pattern teams use for **offline controller secrets**) so break-glass credentials are not only on laptops or CI.
4. **Restore drill** — At least annually: restore a **non-production** canister or fixture from backup and verify note counts and hashes.

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
