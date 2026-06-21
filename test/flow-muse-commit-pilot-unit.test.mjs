/**
 * Unit tests — Muse commit pilot evidence validators (7A-14).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseGeneratedMarkerVersion,
  assertCleanAntiDriftDiff,
  assertNoSecretLeakageInProjection,
} from '../lib/flow/muse-commit-pilot-evidence.mjs';

describe('muse-commit-pilot-evidence (unit, 7A-14)', () => {
  it('parseGeneratedMarkerVersion extracts semver from marker line', () => {
    const sample = `# Title

<!-- GENERATED FROM CANONICAL FLOW flow_overseer_handover@0.2.0 (generator v1) — DO NOT EDIT; regenerate via knowtation flow project -->
`;
    assert.equal(parseGeneratedMarkerVersion(sample), '0.2.0');
  });

  it('assertCleanAntiDriftDiff accepts two-line canonical + marker change', () => {
    const diff = `--- a
+++ b
@@ -1,2 +1,2 @@
-<!-- GENERATED FROM CANONICAL FLOW flow_overseer_handover@0.1.0 (generator v1) — DO NOT EDIT -->
+<!-- GENERATED FROM CANONICAL FLOW flow_overseer_handover@0.2.0 (generator v1) — DO NOT EDIT -->
-Docs-first handover … update durable docs, then regenerate …
+Docs-first handover … update the durable docs (ROADMAP snapshot, next-session plan, coordination doc), then regenerate …
`;
    assert.deepEqual(assertCleanAntiDriftDiff(diff), { ok: true });
  });

  it('assertCleanAntiDriftDiff rejects extra drift lines', () => {
    const diff = `--- a
+++ b
@@ -1,3 +1,3 @@
-old
+new
-extra
+drift
`;
    const result = assertCleanAntiDriftDiff(diff);
    assert.equal(result.ok, false);
  });

  it('assertNoSecretLeakageInProjection allows boundary instruction text', () => {
    const content = `# Flow

No secrets in captured output.
No secrets in the block.
`;
    assert.deepEqual(assertNoSecretLeakageInProjection(content), { ok: true });
  });

  it('assertNoSecretLeakageInProjection flags credential-like tokens', () => {
    const content = 'api_key=super-secret-value';
    const result = assertNoSecretLeakageInProjection(content);
    assert.equal(result.ok, false);
    assert.ok(result.matches.length > 0);
  });
});
