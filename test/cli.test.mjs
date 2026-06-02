/**
 * CLI tests: exit codes and JSON output for list-notes, get-note (with fixture vault).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const cliPath = path.join(projectRoot, 'cli', 'index.mjs');
const fixtureVault = path.join(__dirname, 'fixtures', 'vault-fs');
const isolatedCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'knowtation-cli-test-'));

function cliEnv(env = {}) {
  return {
    ...process.env,
    NETLIFY: '1',
    KNOWTATION_VAULT_PATH: fixtureVault,
    ...env,
  };
}

function runCli(args, env = {}) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    cwd: isolatedCwd,
    env: cliEnv(env),
  });
}

function runCliExitCode(args, env = {}) {
  try {
    runCli(args, env);
    return 0;
  } catch (e) {
    return e.status ?? e.code ?? 1;
  }
}

describe('CLI', () => {
  describe('list-notes', () => {
    it('exits 0 with --json and outputs valid JSON with notes and total', () => {
      const out = runCli(['list-notes', '--limit', '2', '--json']);
      const data = JSON.parse(out);
      assert(Array.isArray(data.notes));
      assert(typeof data.total === 'number');
      assert(data.notes.length <= 2);
    });

    it('--count-only --json outputs only total', () => {
      const out = runCli(['list-notes', '--count-only', '--json']);
      const data = JSON.parse(out);
      assert(typeof data.total === 'number');
      assert.strictEqual(data.notes, undefined);
    });
  });

  describe('get-note', () => {
    it('exits 0 with --json and outputs path, frontmatter, body', () => {
      const out = runCli(['get-note', 'inbox/one.md', '--json']);
      const data = JSON.parse(out);
      assert.strictEqual(data.path, 'inbox/one.md');
      assert(data.body && data.body.includes('Inbox one'));
      assert(typeof data.frontmatter === 'object');
    });

    it('exits non-zero for missing note', () => {
      const code = runCliExitCode(['get-note', 'inbox/nonexistent.md', '--json']);
      assert(code !== 0);
    });
  });

  describe('get-note-outline', () => {
    it('exits 0 with --json and outputs the NoteOutline contract', () => {
      const out = runCli(['get-note-outline', 'inbox/one.md', '--json']);
      const data = JSON.parse(out);
      assert.strictEqual(data.schema, 'knowtation.note_outline/v1');
      assert.strictEqual(data.path, 'inbox/one.md');
      assert.strictEqual(data.title, 'one');
      assert.deepStrictEqual(data.headings, [
        { level: 1, text: 'Inbox one', id: 'h1-inbox-one-0001' },
      ]);
      assert.strictEqual(data.truncated, false);
    });

    it('does not include body, snippets, frontmatter, or absolute paths', () => {
      const out = runCli(['get-note-outline', 'inbox/one.md', '--json']);
      const data = JSON.parse(out);
      const serialized = JSON.stringify(data);
      assert.strictEqual(Object.hasOwn(data, 'body'), false);
      assert.strictEqual(Object.hasOwn(data, 'snippet'), false);
      assert.strictEqual(Object.hasOwn(data, 'frontmatter'), false);
      assert.strictEqual(serialized.includes('Body of inbox one'), false);
      assert.strictEqual(serialized.includes('/Users/'), false);
    });

    it('exits non-zero for missing note', () => {
      const code = runCliExitCode(['get-note-outline', 'inbox/nonexistent.md', '--json']);
      assert.notStrictEqual(code, 0);
    });

    it('exits non-zero for traversal paths', () => {
      const code = runCliExitCode(['get-note-outline', '../../../etc/passwd', '--json']);
      assert.notStrictEqual(code, 0);
    });
  });

  describe('get-document-tree', () => {
    it('exits 0 with --json and outputs the DocumentTree v0 contract', () => {
      const out = runCli(['get-document-tree', 'inbox/one.md', '--json']);
      const data = JSON.parse(out);
      assert.strictEqual(data.schema, 'knowtation.document_tree/v0');
      assert.strictEqual(data.path, 'inbox/one.md');
      assert.strictEqual(data.title, 'one');
      assert.deepStrictEqual(data.root, {
        children: [
          {
            id: 'h1-inbox-one-0001',
            level: 1,
            text: 'Inbox one',
            children: [],
          },
        ],
      });
      assert.strictEqual(data.truncated, false);
    });

    it('does not include body, snippets, frontmatter, absolute paths, or summaries', () => {
      const out = runCli(['get-document-tree', 'inbox/one.md', '--json']);
      const data = JSON.parse(out);
      const serialized = JSON.stringify(data);
      assert.strictEqual(Object.hasOwn(data, 'body'), false);
      assert.strictEqual(Object.hasOwn(data, 'snippet'), false);
      assert.strictEqual(Object.hasOwn(data, 'frontmatter'), false);
      assert.strictEqual(Object.hasOwn(data, 'summary'), false);
      assert.strictEqual(serialized.includes('Body of inbox one'), false);
      assert.strictEqual(serialized.includes('/Users/'), false);
    });

    it('exits non-zero when --json is missing', () => {
      const code = runCliExitCode(['get-document-tree', 'inbox/one.md']);
      assert.notStrictEqual(code, 0);
    });

    it('exits non-zero for missing note', () => {
      const code = runCliExitCode(['get-document-tree', 'inbox/nonexistent.md', '--json']);
      assert.notStrictEqual(code, 0);
    });

    it('exits non-zero for traversal paths', () => {
      const code = runCliExitCode(['get-document-tree', '../../../etc/passwd', '--json']);
      assert.notStrictEqual(code, 0);
    });
  });

  describe('get-metadata-facets', () => {
    it('exits 0 with --json and outputs the MetadataFacets v0 contract', () => {
      const out = runCli(['get-metadata-facets', 'inbox/one.md', '--json']);
      const data = JSON.parse(out);
      assert.deepStrictEqual(data, {
        schema: 'knowtation.metadata_facets/v0',
        path: 'inbox/one.md',
        facets: {
          project: 'foo',
          tags: ['a', 'b'],
          date: '2025-03-01T00:00:00.000Z',
          updated: null,
          causal_chain_id: null,
          entity: [],
          episode_id: null,
        },
        inferred: {
          folder: 'inbox',
          source_type: null,
        },
        truncated: false,
      });
    });

    it('does not include body, snippets, full frontmatter, or absolute paths', () => {
      const out = runCli(['get-metadata-facets', 'inbox/one.md', '--json']);
      const data = JSON.parse(out);
      const serialized = JSON.stringify(data);
      assert.strictEqual(Object.hasOwn(data, 'body'), false);
      assert.strictEqual(Object.hasOwn(data, 'snippet'), false);
      assert.strictEqual(Object.hasOwn(data, 'frontmatter'), false);
      assert.strictEqual(Object.hasOwn(data, 'summary'), false);
      assert.strictEqual(serialized.includes('Body of inbox one'), false);
      assert.strictEqual(serialized.includes('/Users/'), false);
    });

    it('exits non-zero when --json is missing', () => {
      const code = runCliExitCode(['get-metadata-facets', 'inbox/one.md']);
      assert.notStrictEqual(code, 0);
    });

    it('exits non-zero for missing note', () => {
      const code = runCliExitCode(['get-metadata-facets', 'inbox/nonexistent.md', '--json']);
      assert.notStrictEqual(code, 0);
    });

    it('exits non-zero for traversal paths', () => {
      const code = runCliExitCode(['get-metadata-facets', '../../../etc/passwd', '--json']);
      assert.notStrictEqual(code, 0);
    });
  });

  describe('get-section-source', () => {
    it('exits 0 with --json and outputs the SectionSource v0 contract', () => {
      const out = runCli(['get-section-source', 'inbox/one.md', '--json']);
      const data = JSON.parse(out);

      assert.deepStrictEqual(data, {
        schema: 'knowtation.section_source/v0',
        path: 'inbox/one.md',
        title: 'one',
        sections: [
          {
            section_id: 'inbox-one-md:h1-inbox-one-0001',
            heading_id: 'h1-inbox-one-0001',
            level: 1,
            heading_path: ['Inbox one'],
            heading_text: 'Inbox one',
            child_section_ids: [],
            body_available: true,
            body_returned: false,
            snippet_returned: false,
          },
        ],
        truncated: false,
      });
    });

    it('does not include body, snippets, full frontmatter, absolute paths, or transport metadata', () => {
      const out = runCli(['get-section-source', 'inbox/one.md', '--json']);
      const data = JSON.parse(out);
      const serialized = JSON.stringify(data);

      assert.strictEqual(Object.hasOwn(data, 'body'), false);
      assert.strictEqual(Object.hasOwn(data, 'snippet'), false);
      assert.strictEqual(Object.hasOwn(data, 'frontmatter'), false);
      assert.strictEqual(Object.hasOwn(data, 'summary'), false);
      assert.strictEqual(Object.hasOwn(data, 'resource_uri'), false);
      assert.strictEqual(serialized.includes('Body of inbox one'), false);
      assert.strictEqual(serialized.includes('/Users/'), false);
      assert.strictEqual(serialized.includes('knowtation://'), false);
    });

    it('exits non-zero when --json is missing', () => {
      const code = runCliExitCode(['get-section-source', 'inbox/one.md']);
      assert.notStrictEqual(code, 0);
    });

    it('exits non-zero when more than one path is supplied', () => {
      const code = runCliExitCode(['get-section-source', 'inbox/one.md', 'inbox/two.md', '--json']);
      assert.notStrictEqual(code, 0);
    });

    it('exits non-zero for missing note', () => {
      const code = runCliExitCode(['get-section-source', 'inbox/nonexistent.md', '--json']);
      assert.notStrictEqual(code, 0);
    });

    it('exits non-zero for traversal paths', () => {
      const code = runCliExitCode(['get-section-source', '../../../etc/passwd', '--json']);
      assert.notStrictEqual(code, 0);
    });
  });

  describe('help', () => {
    it('--help exits 0', () => {
      const code = runCliExitCode(['--help']);
      assert.strictEqual(code, 0);
    });
  });

  describe('doctor', () => {
    it('--json exits 0 with ok and token_layers', () => {
      const env = cliEnv();
      delete env.KNOWTATION_HUB_URL;
      delete env.KNOWTATION_HUB_TOKEN;
      delete env.KNOWTATION_HUB_VAULT_ID;
      const out = execFileSync(process.execPath, [cliPath, 'doctor', '--json'], {
        encoding: 'utf8',
        cwd: isolatedCwd,
        env,
      });
      const data = JSON.parse(out);
      assert.strictEqual(typeof data.ok, 'boolean');
      assert.ok(data.token_layers);
      assert.ok(data.token_layers.vault_retrieval);
      assert.ok(data.token_layers.terminal_tooling);
      assert.strictEqual(data.self_hosted.config_loaded, true);
      assert.strictEqual(data.self_hosted.vault_readable, true);
    });
  });
});
