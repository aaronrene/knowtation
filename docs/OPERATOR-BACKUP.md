# Operator backup (two pillars)

Knowtation hosted operators use **two** complementary mechanisms. Both are part of the supported runbook; neither replaces the other.

## Pillar 1 — ICP canister snapshots (maintenance / upgrades)

**Purpose:** Roll the **hub** or **attestation** canister back to a saved point after a bad upgrade or break-glass event.

**How:** Controller identity, `dfx canister stop` → `snapshot create` → `start` (brief downtime). Optional `snapshot download` for an off-chain copy.

**Docs & tooling:**

- [ICP-CANISTER-SNAPSHOT-RUNBOOK.md](./ICP-CANISTER-SNAPSHOT-RUNBOOK.md)
- [ICP-CANISTER-SNAPSHOT-AUTOMATION.md](./ICP-CANISTER-SNAPSHOT-AUTOMATION.md) (why not to put controller PEM on GitHub-hosted runners by default)
- [ICP-CANISTER-SNAPSHOT-DRILL-CHECKLIST.md](./ICP-CANISTER-SNAPSHOT-DRILL-CHECKLIST.md)
- `npm run canister:snapshot-backup` — [scripts/icp-canister-snapshot-backup.sh](../scripts/icp-canister-snapshot-backup.sh)

**When:** Planned windows before risky deploys, not as a substitute for daily data continuity.

---

## Pillar 2 — Daily logical export (all tenants, canister stays up)

**Purpose:** Scheduled copy of **vault notes + proposals** for **every** user id stored in the hub canister, without stopping the canister.

**How:**

1. **Configure** the hub canister with a shared secret (controllers only), after deploying WASM that includes `operator_export_secret` in stable storage:

   ```bash
   cd hub/icp && dfx canister call hub admin_set_operator_export_secret '("YOUR_LONG_RANDOM_SECRET")' --network ic
   ```

   See [HUB-API.md](./HUB-API.md) §5.1 and [CANISTER-AUTH-CONTRACT.md](./CANISTER-AUTH-CONTRACT.md) §6.
2. **Run** `npm run canister:operator-full-export` (or GitHub Actions workflow) with `KNOWTATION_OPERATOR_EXPORT_URL`, `KNOWTATION_OPERATOR_EXPORT_KEY`, and optional encrypt/S3 env vars (same pattern as [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md) §6).

**Scripts & CI:**

- [scripts/canister-operator-full-export.mjs](../scripts/canister-operator-full-export.mjs)
- [.github/workflows/canister-operator-full-export.yml](../.github/workflows/canister-operator-full-export.yml)

**Legacy (single partition):** [scripts/canister-export-backup.mjs](../scripts/canister-export-backup.mjs) and [Scheduled HTTP vault export (operator)](./DEPLOY-HOSTED.md#6-scheduled-http-vault-export-operator--not-full-canister-backup) remain available for smoke tests or one `X-User-Id` only.

---

## Related

- [HOSTED-PLATFORM-BACKUP-ROADMAP.md](./HOSTED-PLATFORM-BACKUP-ROADMAP.md)
- [DEPLOY-HOSTED.md](./DEPLOY-HOSTED.md)
- [CANISTER-AUTH-CONTRACT.md](./CANISTER-AUTH-CONTRACT.md) § operator export
