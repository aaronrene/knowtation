/**
 * Tier 1 — UNIT: projection generator pure functions.
 *
 * @see docs/FLOW-PROJECTION-GENERATOR-CONTRACT-7A-11.md §9
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isHarnessActive,
  projectFlow,
  computeFidelity,
  renderedContentHash,
  isProjectionStale,
  detectDrift,
  flowProjectionForClient,
  GENERATED_MARKER_PREFIX,
  HARNESS_VALUES,
} from '../lib/flow/projection-generator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const handoverBundle = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../flows/starter/flow_overseer_handover.json'), 'utf8'),
);

describe('projection generator — unit', () => {
  it('isHarnessActive is true only for cursor_rule and cli_runbook', () => {
    assert.equal(isHarnessActive('cursor_rule'), true);
    assert.equal(isHarnessActive('cli_runbook'), true);
    for (const h of HARNESS_VALUES) {
      if (h !== 'cursor_rule' && h !== 'cli_runbook') {
        assert.equal(isHarnessActive(h), false);
      }
    }
  });

  it('projectFlow returns §1.7 shape with marker-first rendered and ordered steps', () => {
    const projection = projectFlow(handoverBundle.flow, handoverBundle.steps, {
      harness: 'cli_runbook',
    });
    assert.equal(projection.schema, 'knowtation.flow_projection/v0');
    assert.equal(projection.generated_from_canonical, true);
    assert.equal(projection.editable, false);
    assert.ok(projection.rendered.includes(GENERATED_MARKER_PREFIX));
    assert.ok(projection.rendered.indexOf('## Step 1') < projection.rendered.indexOf('## Step 2'));
    const client = flowProjectionForClient(projection);
    assert.deepEqual(Object.keys(client).sort(), Object.keys(projection).sort());
    assert.equal(Object.keys(client).length, Object.keys(projection).length);
  });

  it('projectFlow is deterministic for identical input', () => {
    const a = projectFlow(handoverBundle.flow, handoverBundle.steps, { harness: 'cursor_rule' });
    const b = projectFlow(handoverBundle.flow, handoverBundle.steps, { harness: 'cursor_rule' });
    assert.equal(a.rendered, b.rendered);
    assert.equal(renderedContentHash(a.rendered), renderedContentHash(b.rendered));
  });

  it('computeFidelity lists present-but-unexpressible fields for cursor_rule', () => {
    const fidelity = computeFidelity('cursor_rule', handoverBundle.flow, handoverBundle.steps);
    assert.ok(fidelity.dropped_fields.includes('when_not_to_run'));
    assert.ok(fidelity.dropped_fields.includes('requires'));
    assert.deepEqual(fidelity.dropped_fields, [...fidelity.dropped_fields].sort());
    const runbook = computeFidelity('cli_runbook', handoverBundle.flow, handoverBundle.steps);
    assert.ok(!runbook.dropped_fields.includes('when_not_to_run'));
  });

  it('isProjectionStale fails closed on unparseable and compares semver', () => {
    assert.equal(isProjectionStale('0.1.0', '0.2.0'), true);
    assert.equal(isProjectionStale('0.2.0', '0.2.0'), false);
    assert.equal(isProjectionStale('0.2.0', '0.1.0'), false);
    assert.equal(isProjectionStale('bad', '0.1.0'), true);
    assert.equal(isProjectionStale('0.1.0', 'bad'), true);
  });

  it('renderedContentHash is stable and sensitive to one-byte changes', () => {
    const projection = projectFlow(handoverBundle.flow, handoverBundle.steps, {
      harness: 'cli_runbook',
    });
    const h1 = renderedContentHash(projection.rendered);
    const h2 = renderedContentHash(projection.rendered);
    assert.equal(h1, h2);
    assert.match(h1, /^sha256:[a-f0-9]{64}$/);
    const mutated = `${projection.rendered}x`;
    assert.notEqual(renderedContentHash(mutated), h1);
  });

  it('detectDrift classifies clean, edited, missing_marker, and absent', () => {
    const fresh = projectFlow(handoverBundle.flow, handoverBundle.steps, {
      harness: 'cli_runbook',
    }).rendered;
    assert.deepEqual(detectDrift(fresh, fresh), { drift: false, reason: 'clean' });
    assert.deepEqual(detectDrift('# hand edited\n', fresh), {
      drift: true,
      reason: 'missing_marker',
    });
    assert.deepEqual(detectDrift('', fresh), { drift: true, reason: 'absent' });
    assert.deepEqual(detectDrift(`${fresh}\nextra`, fresh), { drift: true, reason: 'edited' });
  });
});
