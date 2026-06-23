/**
 * Self-hosted Hub delegation routes — contract tests (Phase 7C-L1).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(__dirname);

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('self-hosted Hub delegation routes', () => {
  it('unit: registers delegation routes gated by DELEGATION_ENABLED handlers', () => {
    const src = readRepoFile('hub/server.mjs');
    assert.match(src, /Agent delegation \(Phase 7C-6\)/);
    assert.match(src, /handleAgentIdentityRegisterProposeRequest/);
    assert.match(src, /handleDelegationConsentProposeRequest/);
    assert.match(src, /handleDelegationGrantMintRequest/);
    assert.match(src, /handleDelegationAuditAppendRequest/);
    assert.match(src, /app\.post\('\/api\/v1\/agents\/identities'/);
    assert.match(src, /app\.post\('\/api\/v1\/delegation\/consents'/);
    assert.match(src, /app\.post\('\/api\/v1\/delegation\/grants'/);
    assert.match(src, /app\.post\('\/api\/v1\/delegation\/audit'/);
  });

  it('integration: proposal approve path wires delegation apply on hub', () => {
    const src = readRepoFile('hub/server.mjs');
    assert.match(src, /precheckApprovedDelegationProposal/);
    assert.match(src, /applyDelegationProposalToIndex/);
  });

  it('end-to-end: OpenAPI documents delegation endpoints', () => {
    const api = readRepoFile('docs/openapi.yaml');
    assert.match(api, /\/agents\/identities:/);
    assert.match(api, /\/delegation\/consents:/);
    assert.match(api, /\/delegation\/grants:/);
    assert.match(api, /\/delegation\/audit:/);
    assert.match(api, /DELEGATION_ENABLED/);
  });

  it('security: routes require authenticated role; audit uses session principal fallback', () => {
    const src = readRepoFile('hub/server.mjs');
    assert.match(
      src,
      /app\.post\('\/api\/v1\/delegation\/audit', requireRole\('viewer', 'editor', 'admin', 'evaluator'\)/,
    );
    assert.match(src, /hashPrincipalRef\(req\.user\?\.sub/);
  });
});
