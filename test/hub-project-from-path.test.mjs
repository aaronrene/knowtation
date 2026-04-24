/**
 * Contract for vault path → project slug (mirrors web/hub/hub.js projectSlugFromProjectsPath).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

function projectSlugFromProjectsPath(path) {
  if (!path || typeof path !== 'string') return null;
  const m = path.match(/^projects\/([^/]+)(?:\/|$)/);
  return m ? m[1] : null;
}

function projectsPathTypoSuggestion(path) {
  const p = String(path || '').trim();
  if (!p) return null;
  if (/^project\//.test(p) && !/^projects\//.test(p)) return p.replace(/^project\//, 'projects/');
  return null;
}

describe('project slug from projects/… vault paths', () => {
  it('returns first segment after projects/', () => {
    assert.strictEqual(projectSlugFromProjectsPath('projects/foo/inbox/x.md'), 'foo');
    assert.strictEqual(projectSlugFromProjectsPath('projects/bar-baz/note.md'), 'bar-baz');
  });

  it('returns null when not under projects/', () => {
    assert.strictEqual(projectSlugFromProjectsPath('inbox/x.md'), null);
    assert.strictEqual(projectSlugFromProjectsPath('deep/projects/no.md'), null);
    assert.strictEqual(projectSlugFromProjectsPath(null), null);
  });

  it('treats projects/foo.md as segment foo.md (single path component)', () => {
    assert.strictEqual(projectSlugFromProjectsPath('projects/foo.md'), 'foo.md');
  });
});

describe('projects/ vs project/ typo fix suggestion', () => {
  it('rewrites project/ prefix to projects/', () => {
    assert.strictEqual(projectsPathTypoSuggestion('project/acme/inbox/x.md'), 'projects/acme/inbox/x.md');
  });

  it('does not rewrite valid projects/ paths', () => {
    assert.strictEqual(projectsPathTypoSuggestion('projects/acme/inbox/x.md'), null);
  });

  it('does not treat unrelated paths as typos', () => {
    assert.strictEqual(projectsPathTypoSuggestion('inbox/x.md'), null);
    assert.strictEqual(projectsPathTypoSuggestion('deep/project/file.md'), null);
  });
});
