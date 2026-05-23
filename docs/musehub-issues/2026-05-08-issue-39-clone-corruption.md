---
date: 2026-05-08
status: filed
issue_number: 39
issue_id: sha256:c570f79c16f0e472731c474782ac664f686c43ff4f7b2e7088551d0f656780d0
repo: gabriel/musehub
url: https://staging.musehub.ai/gabriel/musehub/issues/39
title: muse clone gabriel/muse fails on both staging (object integrity) and production (msgpack)
labels: [bug, clone]
event_type: discover
tags: [contributions, musehub, bug-report, clone, infrastructure, blocks-contribution]
related: [issue-36, issue-38]
---

# Issue #39 — `muse clone gabriel/muse` fails on both staging and production

Filed: 2026-05-08
Repo: gabriel/musehub
URL: https://staging.musehub.ai/gabriel/musehub/issues/39

Discovered while attempting to submit issue #38 fix as a proper merge proposal (the contributor flow). Both clone endpoints fail in different ways. Blocks any external contribution work against `gabriel/muse`.

## Issue body (as filed)

# `muse clone gabriel/muse` fails on both staging and production

**Affected component:** `muse clone` against the `gabriel/muse` repo
**Affected versions:** client `0.2.0rc7` against `staging.musehub.ai` and `musehub.ai` (2026-05-09)
**Severity:** High — blocks the entire contributor merge-proposal workflow against `gabriel/muse`. External contributors cannot fork, branch, push, or open proposals.
**Reporter:** @aaronrene
**Related:** Issue #38 (the bridge exec-bit fix that the reporter would have submitted as a merge proposal but couldn't, because of this issue).

---

## Plain-language summary

I tried to do exactly what an outside contributor is supposed to do: clone the `muse` source repository, make a small bug fix on a feature branch, push, and open a merge proposal. Both clone endpoints are broken in different ways. **Staging** returns ~25 files whose downloaded content doesn't match the hash the server says they should have, then dies on a missing object (HTTP 404). **Production** rejects every request because the wire format the server is sending isn't something the latest client can parse. Either of these alone would block clone; together they block clone entirely.

This means there is currently no way for a third party to make code contributions to `gabriel/muse` through the standard MuseHub flow, even when the contributor has a working client, valid auth, and a perfectly good patch ready to go.

## Technical summary

Two distinct, simultaneously-occurring failure modes against the same logical repo:

**Failure A — staging integrity violations + 404**
```
$ muse clone https://staging.musehub.ai/gabriel/muse muse-source
clone: skipping corrupted object sha256:1e4d2c138a5b…: Content integrity failure:
    expected object sha256:1e4d2c138a5b… got sha256:cf9ad6812fc5…
clone: skipping corrupted object sha256:90ecc4781a20…: Content integrity failure:
    expected object sha256:90ecc4781a20… got sha256:0764d5e337ea…
[… 23 more "Content integrity failure" lines, each pair of expected/got hashes is consistent (same expected → same got) ...]
❌ Fetch failed: fetch/presign: object GET HTTP 404
exit_code: 3, elapsed_ms: 117059
```

The 25 reported pairs are all of the form `expected sha256:X got sha256:Y` where X and Y are deterministic — re-running the clone gets the same hash mismatch for each object, suggesting these are not transient read errors but objects whose stored bytes do not match their advertised content hashes. After 25 such warnings the clone hits an `HTTP 404` on a presigned object URL and aborts, producing no usable repository.

**Failure B — production msgpack mismatch**
```
$ muse clone https://musehub.ai/gabriel/muse muse-source
Cloning from https://musehub.ai/gabriel/muse …
❌ Cannot reach remote: Server returned invalid msgpack: unpack(b) received extra data.
exit_code: 3, elapsed_ms: 1469
```

Production rejects `0.2.0rc7` immediately. `unpack(b) received extra data` means msgpack reached the end of one valid object but found additional bytes in the buffer that don't belong to it — the server is either framing responses differently than the client expects (e.g. concatenated NDmsgpack or a different content-length contract), or running an older/newer schema entirely.

## Reproducer

```bash
# Pre-conditions — fresh client install
curl -fsSL https://staging.musehub.ai/install.sh | sh
muse --version    # confirms 0.2.0rc7

# Reproducer A — staging
mkdir -p /tmp/clone-test-A && cd /tmp/clone-test-A
muse clone https://staging.musehub.ai/gabriel/muse repo
# Observe: many "Content integrity failure" lines, then HTTP 404, exit 3.

# Reproducer B — production
rm -rf /tmp/clone-test-B && mkdir /tmp/clone-test-B && cd /tmp/clone-test-B
muse clone https://musehub.ai/gabriel/muse repo
# Observe: "Server returned invalid msgpack: unpack(b) received extra data", exit 3.

# Sanity — does aaronrene/knowtation clone successfully? (yes, both endpoints)
mkdir -p /tmp/clone-test-C && cd /tmp/clone-test-C
muse clone https://staging.musehub.ai/aaronrene/knowtation repo
# Observe: clean clone, no integrity failures.
```

This pattern — `aaronrene/knowtation` clones cleanly while `gabriel/muse` does not — strongly suggests the issue is **specific to the `gabriel/muse` repo's stored objects on staging**, not a generic clone bug. Production's msgpack failure is presumably an unrelated server-version mismatch.

## Expected behaviour

- Both endpoints accept the latest client and return a complete, hash-verified clone.
- A contributor with a fresh `0.2.0rc7` client can clone, create a feature branch, commit changes, push, and open a merge proposal against `gabriel/muse`.

## Actual behaviour

- Staging produces a partial clone with 25 unverifiable objects then aborts.
- Production rejects every request before any objects transfer.
- No contributor merge-proposal flow is currently possible against `gabriel/muse`.

## Possible root causes (best guesses, not verified)

For staging:
1. **Stale data in the object store.** The 25 objects' stored bytes were rewritten at some point (perhaps during the `compute_commit_id` deployment that fixed issue #36), but their addresses in the store are still the legacy hashes. Re-uploading the corrected blob bytes under their new hashes — and updating commit/snapshot pointers to match — would resolve.
2. **Pack-rebuild interrupted mid-flight.** A re-pack process started but didn't complete, leaving some objects with manifest entries that point to in-flight content. A `muse gc` or admin re-pack on the server side may fix.
3. **Migration from v1 → v2 commit-ID formula didn't propagate to all blob references.** If snapshots inside old commits still address blobs by their pre-migration hashes, those would now hash-mismatch.

For production:
1. **`musehub.ai` (production) is running a different protocol version than the client.** Client `0.2.0rc7` was installed from `staging.musehub.ai/install.sh` and is presumably matched to staging's protocol. Production may be on an older or newer ABI. Could be fixed by aligning protocols, or by the client downgrading/upgrading transparently per server version.

I don't have access to either server's logs and these are pure inference — open to being told which of these (or something else entirely) is correct.

## Workaround in use today

Reporter applied the patch from issue #38 directly to the local `0.2.0rc7` install (`StrReplace` against `~/.local/share/muse/venv/lib/python3.14/site-packages/muse/cli/commands/bridge.py`), validated the fix end-to-end, then rolled back. The patch was submitted as issue body / unified diff in #38 rather than as a merge proposal. **This works for tiny patches but doesn't scale** — anything more than ~50 lines, or anything that needs a real test suite committed alongside the fix, requires a working clone.

## What I'd like to do once this is fixed

1. Re-clone `gabriel/muse` cleanly.
2. Apply the patch from issue #38 to a feature branch (`feat/bridge-exec-bit-fix`).
3. Push to `gabriel/muse`.
4. Open a proper merge proposal targeting `main`.
5. Get the merge proposal credited with proper attribution (commit `Co-authored-by: aaronrene` or similar).
6. Use the same flow for any future contributions.

## Severity / urgency

**High but not urgent for the reporter individually** — issue #38 contains a workable fix even without a clone, so the immediate symptom is unblocked. **High and urgent for the project** — every prospective contributor hits this wall. The longer it persists the smaller the contributor pool gets.

## Suggested labels

`bug` · `clone` · `infrastructure` · `blocks-contribution`

## Related

- Issue #36 (resolved): `compute_commit_id` formula divergence — fixed via server reset of `staging/main`. The 25 corrupted-object reports here may be related: if the server reset migrated commits but didn't migrate blob addresses, that would explain the integrity failures we observe.
- Issue #38 (open): `muse bridge git-export` strips exec bit. Complete patch attached, would have been a merge proposal if this clone issue weren't blocking.
