import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  materializeListFrontmatter,
  deriveFacetsFromCanisterNotes,
} from '../hub/gateway/note-facets.mjs';

describe('note-facets', () => {
  it('materializeListFrontmatter parses JSON string', () => {
    const fm = materializeListFrontmatter('{"tags":"a,b","project":"p1"}');
    assert.equal(fm.project, 'p1');
    assert.ok(Array.isArray(fm.tags) === false);
  });

  it('deriveFacetsFromCanisterNotes collects folders tags projects', () => {
    const facets = deriveFacetsFromCanisterNotes([
      { path: 'inbox/x.md', frontmatter: '{"tags":"t1, t2","project":"myproj"}' },
      { path: 'projects/launch/a.md', frontmatter: '{}' },
    ]);
    assert.ok(facets.folders.includes('inbox'));
    assert.ok(facets.folders.includes('projects'));
    assert.ok(facets.tags.includes('t1'));
    assert.ok(facets.tags.includes('t2'));
    assert.ok(facets.projects.includes('myproj'));
  });

  it('empty string frontmatter yields empty facets aside from folder from path', () => {
    const facets = deriveFacetsFromCanisterNotes([{ path: 'inbox/y.md', frontmatter: '{}' }]);
    assert.equal(facets.projects.length, 0);
    assert.equal(facets.tags.length, 0);
    assert.deepEqual(facets.folders, ['inbox']);
  });
});
