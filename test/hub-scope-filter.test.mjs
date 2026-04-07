import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  applyScopeFilterToNotes,
  applyScopeFilterToProposals,
} from '../hub/lib/scope-filter.mjs';

describe('applyScopeFilterToProposals', () => {
  it('returns all proposals when scope is empty', () => {
    const ps = [{ path: 'inbox/a.md' }, { path: 'projects/foo/x.md' }];
    assert.deepStrictEqual(applyScopeFilterToProposals(ps, null), ps);
    assert.deepStrictEqual(applyScopeFilterToProposals(ps, {}), ps);
  });

  it('filters by folder prefix like notes', () => {
    const scope = { folders: ['inbox'] };
    const ps = [{ path: 'inbox/a.md' }, { path: 'other/b.md' }];
    assert.deepStrictEqual(applyScopeFilterToProposals(ps, scope), [{ path: 'inbox/a.md' }]);
  });

  it('filters by project from path projects/slug/', () => {
    const scope = { projects: ['foo'] };
    const ps = [{ path: 'projects/foo/note.md' }, { path: 'projects/bar/note.md' }];
    assert.deepStrictEqual(applyScopeFilterToProposals(ps, scope), [{ path: 'projects/foo/note.md' }]);
  });

  it('filters by project from parsed frontmatter object', () => {
    const scope = { projects: ['alpha'] };
    const ps = [
      { path: 'x.md', frontmatter: { project: 'alpha' } },
      { path: 'y.md', frontmatter: { project: 'beta' } },
    ];
    assert.deepStrictEqual(applyScopeFilterToProposals(ps, scope), [{ path: 'x.md', frontmatter: { project: 'alpha' } }]);
  });

  it('matches applyScopeFilterToNotes for same path set', () => {
    const scope = { folders: ['inbox'], projects: ['p1'] };
    const notes = [
      { path: 'inbox/n.md', project: null },
      { path: 'deep/x.md', project: 'p1' },
    ];
    const proposals = [{ path: 'inbox/n.md' }, { path: 'deep/x.md', project: 'p1' }];
    const nf = applyScopeFilterToNotes(notes, scope).map((n) => n.path).sort();
    const pf = applyScopeFilterToProposals(proposals, scope).map((p) => p.path).sort();
    assert.deepStrictEqual(pf, nf);
  });
});
