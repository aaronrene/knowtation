# ICP snapshot restore drill — checklist template

**Operator action:** Complete a **non-production** (or disposable) restore drill, then record results **only in private storage** (e.g. `development/` gitignored copy, team vault). **Do not commit** filled rows to the public repository.

The same checklist lives in [ICP-CANISTER-SNAPSHOT-RUNBOOK.md](./ICP-CANISTER-SNAPSHOT-RUNBOOK.md). Use this file as a printable/template copy if you prefer.

| Step | Done | Notes |
|------|------|--------|
| Target is **non-production** or disposable canister | ☐ | |
| Recorded canister name(s) and network | ☐ | |
| Took snapshot **before** drill (current state preserved) | ☐ | |
| Performed test **snapshot load** per runbook | ☐ | |
| Verified **health** / HTTP after `canister start` | ☐ | |
| Snapshot ID(s) used | ☐ | *(private)* |
| Download archive path + checksum (if any) | ☐ | *(private)* |
| Operator + date | ☐ | *(private)* |

After completion, you have satisfied the operational **restore drill** item in [HOSTED-PLATFORM-BACKUP-ROADMAP.md](./HOSTED-PLATFORM-BACKUP-ROADMAP.md).
