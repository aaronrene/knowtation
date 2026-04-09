# ICP canister snapshots: automation decision (operator)

Full canister snapshots require a **controller** identity. That identity can **stop**, **upgrade**, **delete**, and **load** snapshots — full custody of production.

## Recommendation

| Approach | When to use |
|----------|-------------|
| **Manual / operator workstation** | Default. Run [`npm run canister:snapshot-backup`](../package.json) or the commands in [ICP-CANISTER-SNAPSHOT-RUNBOOK.md](./ICP-CANISTER-SNAPSHOT-RUNBOOK.md) during a scheduled maintenance window. Store PEMs in hardware-backed or offline storage per [APRICORN-KNOWTATION-BACKUP-CONTROLLERS.md](./APRICORN-KNOWTATION-BACKUP-CONTROLLERS.md). |
| **Self-hosted GitHub Actions runner** (or other private CI) | If you need a push-button job: runner runs on **your** infra; controller PEM in **OS secret store** or HSM; **no** PEM in repository **Secrets** visible to GitHub-hosted `ubuntu-latest`. |
| **GitHub-hosted runner + controller PEM in repo Secrets** | **Not recommended.** Anyone who can read Actions secrets or compromise the org/repo gains **canister takeover**. Only consider after explicit threat modeling and break-glass procedures. |

## If you automate later

Document privately (not in this repo):

- Who may trigger the job.
- Audit log / notifications.
- Maintenance window and communication (hub downtime on **stop**).
- Rotation if PEM leaks.
- Cap of **10** on-chain snapshots per canister (prune or `--replace` policy).

The existing workflow [`.github/workflows/canister-export-backup.yml`](../.github/workflows/canister-export-backup.yml) remains **HTTP logical export** for one configured `X-User-Id` partition — it does **not** replace snapshots.
