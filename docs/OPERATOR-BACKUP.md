# Operator backup (two pillars)

Knowtation hosted operators use **two** complementary mechanisms. Both are part of the supported runbook; neither replaces the other.

## Pillar 1 — ICP canister snapshots (maintenance / upgrades)

**Purpose:** Roll the **hub** or **attestation** canister back to a saved point after a bad upgrade or break-glass event.

**How:** Controller identity, `dfx canister stop` → `snapshot create` → `start` (brief downtime). Optional `snapshot download` for an off-chain copy.

**Docs & tooling:**

- **[hub/icp/README.md](../hub/icp/README.md)** — canister build, stable memory, HTTP upgrade behavior
- `npm run canister:snapshot-backup` — [scripts/icp-canister-snapshot-backup.sh](../scripts/icp-canister-snapshot-backup.sh)
- Long-form snapshot runbooks: keep under a local **`development/`** tree (gitignored) if you maintain operator-only checklists

**When:** Planned windows before risky deploys, not as a substitute for daily data continuity.

---

## Pillar 2 — Daily logical export (all tenants, canister stays up)

**Purpose:** Scheduled copy of **vault notes + proposals** for **every** user id stored in the hub canister, without stopping the canister.

**How:**

1. **Configure** the hub canister with a shared secret (controllers only), after deploying WASM that includes `operator_export_secret` in stable storage:

   ```bash
   cd hub/icp && dfx canister call hub admin_set_operator_export_secret '("YOUR_LONG_RANDOM_SECRET")' --network ic
   ```

   See [HUB-API.md](./HUB-API.md) §5.1 (operator export).
2. **Run** `npm run canister:operator-full-export` (or GitHub Actions workflow) with `KNOWTATION_OPERATOR_EXPORT_URL`, `KNOWTATION_OPERATOR_EXPORT_KEY`, and optional encrypt/S3 env vars (see script headers and `.env.example`).

**Scripts & CI:**

- [scripts/canister-operator-full-export.mjs](../scripts/canister-operator-full-export.mjs)
- [.github/workflows/canister-operator-full-export.yml](../.github/workflows/canister-operator-full-export.yml)

**Legacy (single partition):** [scripts/canister-export-backup.mjs](../scripts/canister-export-backup.mjs) remains available for smoke tests or one `X-User-Id` only.

---

## Related

- [HUB-API.md](./HUB-API.md) § operator export
- `hub/icp/README.md` — canister deploy and stable memory
