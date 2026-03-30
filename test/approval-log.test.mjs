import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  approvalLogRelativePath,
  isApprovalLogPath,
  filterHitsByContentScope,
  buildApprovalLogWrite,
  resolveSearchFolderForContentScope,
} from '../lib/approval-log.mjs';

test('isApprovalLogPath', () => {
  assert.equal(isApprovalLogPath('approvals/2026-03-30-abc.md'), true);
  assert.equal(isApprovalLogPath('inbox/x.md'), false);
});

test('approvalLogRelativePath is stable for uuid', () => {
  const p = approvalLogRelativePath('550e8400-e29b-41d4-a716-446655440000', '2026-03-30T12:00:00.000Z');
  assert.equal(p, 'approvals/2026-03-30-550e8400-e29b-41d4-a716-446655440000.md');
});

test('filterHitsByContentScope', () => {
  const hits = [{ path: 'inbox/a.md' }, { path: 'approvals/2026-03-30-x.md' }];
  assert.equal(filterHitsByContentScope(hits, 'notes').length, 1);
  assert.equal(filterHitsByContentScope(hits, 'approval_logs').length, 1);
  assert.equal(filterHitsByContentScope(hits, 'all').length, 2);
});

test('buildApprovalLogWrite shapes frontmatter', () => {
  const w = buildApprovalLogWrite({
    proposalId: 'pid-1',
    targetPath: 'inbox/foo.md',
    approvedAt: '2026-03-30T00:00:00.000Z',
    approvedBy: 'user-1',
    intent: 'fix typo',
  });
  assert.match(w.relativePath, /^approvals\/2026-03-30-pid-1\.md$/);
  assert.equal(w.frontmatter.kind, 'approval_log');
  assert.equal(w.frontmatter.target_path, 'inbox/foo.md');
  assert.ok(w.body.includes('inbox/foo.md'));
});

test('buildApprovalLogWrite appends proposedBodyExcerpt for search', () => {
  const w = buildApprovalLogWrite({
    proposalId: 'pid-2',
    targetPath: 'x.md',
    approvedAt: '2026-03-30T00:00:00.000Z',
    proposedBodyExcerpt: 'embeddings and indexing test',
  });
  assert.ok(w.body.includes('Proposal excerpt'));
  assert.ok(w.body.includes('embeddings'));
});

test('resolveSearchFolderForContentScope approval_logs uses approvals prefix', () => {
  const r = resolveSearchFolderForContentScope('approval_logs', undefined);
  assert.equal(r.impossible, false);
  assert.equal(r.folder, 'approvals');
  assert.equal(r.wideNotesFetch, false);
});

test('resolveSearchFolderForContentScope approval_logs conflicts with other folder', () => {
  const r = resolveSearchFolderForContentScope('approval_logs', 'projects/foo');
  assert.equal(r.impossible, true);
});

test('resolveSearchFolderForContentScope notes requests wide fetch', () => {
  const r = resolveSearchFolderForContentScope('notes', '');
  assert.equal(r.wideNotesFetch, true);
});
