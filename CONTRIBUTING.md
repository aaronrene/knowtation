# Contributing to Knowtation

Contributions are welcome. Please follow these guidelines to keep the codebase healthy and maintainable.

---

## Quick overview

1. Fork the repo and create a branch from `main`
2. Make your change — see the rules below
3. Run the test suite (`npm test`) and confirm all tests pass
4. Open a pull request

---

## Rules

### Write tests (Rule 0)

Every non-trivial change must include tests. This is non-negotiable. New behaviour without a test is not mergeable.

- Unit tests live in `test/`
- Use the existing `*.test.mjs` pattern
- Run: `npm test` (must show all tests passing)
- Security-related changes: add tests to the appropriate `test/phase*-security.test.mjs` file

### No temporary fixes

Do not submit "quick fixes" or "we'll improve this later" patches. Every change must be permanent and production-ready. If a proper fix requires more time or analysis, open an issue instead.

### No breaking changes without discussion

Changes to public CLI flags, MCP tool signatures, Hub API endpoints, or vault/frontmatter formats are breaking changes. Open an issue first to discuss before implementing.

### Security first

- No hardcoded secrets, credentials, IPs, or tokens in any file
- Run `npm audit` before submitting — the CI gate will fail on high/critical CVEs
- Use timing-safe comparisons for HMAC/secret checks
- Follow the patterns established in the Phase 0–3 security audit (see `docs/SECURITY-AUDIT-PLAN.md`)

---

## Branch and commit conventions

- Branch from `main`; name branches descriptively: `feature/`, `fix/`, `docs/`, `security/`
- Commit messages: short imperative subject line, e.g. `fix: validate zip entry paths against extract dir`
- One logical change per commit; squash noisy WIP commits before opening a PR
- Do not commit `config/local.yaml`, `.env`, or any file under `data/`

---

## Testing

```bash
npm test          # full suite (~1300+ tests)
npm run lint      # if applicable
```

All existing tests must pass. If your change intentionally removes a feature, update or remove the affected tests and explain why in the PR description.

---

## Pull request checklist

- [ ] All tests pass (`npm test`)
- [ ] New behaviour has new tests
- [ ] No secrets or credentials in the diff
- [ ] `npm audit` shows no new high/critical CVEs
- [ ] PR description explains the "why", not just the "what"
- [ ] Breaking changes are called out explicitly

---

## Reporting bugs

Open a [GitHub Issue](../../issues) with:
- Steps to reproduce
- Expected vs actual behaviour
- Node.js version (`node --version`)
- Relevant config (sanitise any secrets)

For security vulnerabilities, see [SECURITY.md](.github/SECURITY.md) — do not use public issues.
