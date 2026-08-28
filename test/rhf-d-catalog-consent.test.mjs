/**
 * RHF-d — catalog match helper unit tests (production probe lives in scripts/).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { getTrustedCatalogIdentity } from '../lib/agent/trusted-external-provider-catalog.mjs';
import { catalogEntryMatches } from '../scripts/verify-rhf-d-catalog-consent.mjs';

describe('RHF-d catalog verification helpers', () => {
  test('frozen retail catalog entry matches itself exactly', () => {
    const expected = getTrustedCatalogIdentity('agent_codex_retail');
    assert.ok(expected);
    const match = catalogEntryMatches(expected, expected);
    assert.equal(match.ok, true);
  });

  test('rejects provider mismatch', () => {
    const expected = getTrustedCatalogIdentity('agent_codex_retail');
    assert.ok(expected);
    const bad = { ...expected, provider: 'groq' };
    const match = catalogEntryMatches(bad, expected);
    assert.equal(match.ok, false);
    assert.equal(match.field, 'provider');
  });
});
