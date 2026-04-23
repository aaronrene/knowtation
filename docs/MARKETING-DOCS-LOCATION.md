# Where internal marketing documents live

**Public OSS repos should not ship** go-to-market plans, positioning drafts, campaign internals, or long-form “agent marketing structure” playbooks. Those files are **not missing**—they are intentionally **kept out of GitHub**.

## Local folder (this clone)

Put (and keep) internal marketing markdown under:

```text
docs/marketing-internal/
```

That path is listed in **`.gitignore`**, so Git **will not commit or push** anything inside it. Your editor and search still see the files on disk.

**Example:** `docs/marketing-internal/AGENT-MARKETING-STRUCTURE.md`

## New machine / teammate

Because the folder is ignored, it **does not appear** when someone clones only the public repo. Share contents through one of:

1. **Private GitHub repository** (recommended for teams)—e.g. `your-org/knowtation-marketing-internal` with the same filenames; clone next to this repo or copy files into `docs/marketing-internal/` when needed.
2. **Encrypted backup** (zip + password, vault, or cloud drive with restricted ACL)—copy the folder in periodically.
3. **Company wiki / Notion / Google Drive**—link from your runbook; keep canonical drafts there if you prefer not to duplicate in git at all.

## If a file was ever pushed to the public repo

Removing it from the latest commit **does not remove it from history**. Anyone who already cloned or browsed old commits may still have it. To **scrub history** you need an explicit rewrite (e.g. `git filter-repo`) and force-push—coordinate with all contributors. For most teams, **rotate any secrets** that ever touched those files and treat the doc as public from then on.

## Related patterns in this repo

- **`development/`** — local-only planning (gitignored).
- **`docs/archive/`** — local snapshots (gitignored).
- **Public marketing *concepts*** that are safe to OSS—keep in normal `docs/` (e.g. high-level agent integration) without internal roadmaps.

For skill-pack **paths** that are already public under `.cursor/skills/packs/`, see [TEMPLATES-AND-SKILLS.md](./TEMPLATES-AND-SKILLS.md) and [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md).
