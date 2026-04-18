/**
 * Markdown task extraction (Issue #1 Phase C7).
 */

import { listMarkdownFiles, readNote, normalizeSlug, normalizeTags } from './vault.mjs';

const TASK_OPEN = /^(\s*)- \[([ xX])\]\s*(.+)$/gm;

/**
 * Markdown checkbox tasks from a note body (Obsidian / GitHub style `- [ ]` / `- [x]`).
 * @param {unknown} body
 * @param {{ path?: string, status?: 'open'|'done'|'all' }} [options]
 * @returns {{ text: string, path: string, line: number, status: 'open'|'done' }[]}
 */
export function extractCheckboxTasksFromBody(body, options = {}) {
  const status = options.status || 'all';
  const pathKey = options.path != null ? String(options.path).replace(/\\/g, '/') : '';
  const text = body != null ? String(body) : '';
  const tasks = [];
  TASK_OPEN.lastIndex = 0;
  let m;
  while ((m = TASK_OPEN.exec(text)) !== null) {
    const checked = m[2].toLowerCase() === 'x';
    const isOpen = !checked;
    if (status === 'open' && !isOpen) continue;
    if (status === 'done' && isOpen) continue;
    const taskText = m[3].trim();
    const lineIdx = text.slice(0, m.index).split('\n').length;
    tasks.push({
      text: taskText,
      path: pathKey,
      line: lineIdx,
      status: isOpen ? 'open' : 'done',
    });
  }
  return tasks;
}

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
    for (const t of extractCheckboxTasksFromBody(body, { path: note.path.replace(/\\/g, '/'), status })) {
      tasks.push(t);
    }
  }

  return { tasks };
}
