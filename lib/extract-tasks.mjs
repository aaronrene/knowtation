/**
 * Markdown task extraction (Issue #1 Phase C7).
 */

import { listMarkdownFiles, readNote, normalizeSlug, normalizeTags } from './vault.mjs';

const TASK_OPEN = /^(\s*)- \[([ xX])\]\s*(.+)$/gm;

/**
 * @param {import('./config.mjs').loadConfig extends () => infer R ? R : never} config
 * @param {{ folder?: string, project?: string, tag?: string, since?: string, status?: 'open'|'done'|'all' }} options
 */
export function runExtractTasks(config, options = {}) {
  const status = options.status || 'all';
  let paths = listMarkdownFiles(config.vault_path, { ignore: config.ignore });

  if (options.folder) {
    const prefix = options.folder.replace(/\\/g, '/').replace(/\/$/, '') + '/';
    const exact = options.folder.replace(/\\/g, '/').replace(/\/$/, '');
    paths = paths.filter((p) => p === exact || p.startsWith(prefix));
  }

  const wantTag = options.tag != null ? normalizeSlug(String(options.tag)) : null;
  const wantProject = options.project != null ? normalizeSlug(String(options.project)) : null;
  const since = options.since != null ? String(options.since).trim().slice(0, 10) : null;

  const tasks = [];

  for (const p of paths) {
    let note;
    try {
      note = readNote(config.vault_path, p);
    } catch (_) {
      continue;
    }
    if (wantProject && note.project !== wantProject) continue;
    if (wantTag) {
      const tags = note.tags?.length ? note.tags : normalizeTags(note.frontmatter?.tags);
      if (!tags.includes(wantTag)) continue;
    }
    if (since) {
      const d = (note.date || note.updated || '').slice(0, 10);
      if (!d || d < since) continue;
    }

    const body = note.body || '';
    let m;
    TASK_OPEN.lastIndex = 0;
    while ((m = TASK_OPEN.exec(body)) !== null) {
      const checked = m[2].toLowerCase() === 'x';
      const isOpen = !checked;
      if (status === 'open' && !isOpen) continue;
      if (status === 'done' && isOpen) continue;
      const text = m[3].trim();
      const lineIdx = body.slice(0, m.index).split('\n').length;
      tasks.push({
        text,
        path: note.path.replace(/\\/g, '/'),
        line: lineIdx,
        status: isOpen ? 'open' : 'done',
      });
    }
  }

  return { tasks };
}
