/**
 * Claude (Anthropic) export importer. Supports folder of Markdown or JSON from third-party exporters.
 * One note per conversation; frontmatter: source: claude, source_id, date.
 */

import fs from 'fs';
import path from 'path';
import { writeNote } from '../write.mjs';
import { parseFrontmatterAndBody, normalizeSlug } from '../vault.mjs';

/**
 * @param {string} input - Path to folder (of .md) or JSON file
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean }} ctx
 * @returns {Promise<{ imported: { path: string, source_id?: string }[], count: number }>}
 */
export async function importClaude(input, ctx) {
  const { vaultPath, outputBase, project, tags, dryRun } = ctx;
  const absInput = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  if (!fs.existsSync(absInput)) {
    throw new Error(`Input not found: ${input}`);
  }

  const stat = fs.statSync(absInput);
  const now = new Date().toISOString().slice(0, 10);
  const imported = [];

  if (stat.isFile() && absInput.endsWith('.json')) {
    const raw = fs.readFileSync(absInput, 'utf8');
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error(`Invalid JSON: ${e.message}`);
    }
    const convs = Array.isArray(data) ? data : (data.conversations ? Object.values(data.conversations) : data.chats || []);
    for (let i = 0; i < convs.length; i++) {
      const c = convs[i];
      const body = typeof c.content === 'string' ? c.content : (c.messages ? formatMessages(c.messages) : JSON.stringify(c));
      const title = c.title || c.name || `Claude ${i + 1}`;
      const sourceId = c.id || c.uuid || `claude_${i}`;
      const date = c.created_at || c.updated_at || c.date || now;
      const d = (typeof date === 'number' ? new Date(date * 1000) : new Date(date)).toISOString().slice(0, 10);
      const safeTitle = String(title).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || `claude-${i}`;
      const outputRel = path.join(outputBase, `${safeTitle}.md`).replace(/\\/g, '/');
      const frontmatter = {
        source: 'claude',
        source_id: String(sourceId).slice(0, 128),
        date: d,
        title,
        ...(project && { project: normalizeSlug(project) }),
        ...(tags.length && { tags }),
      };
      if (!dryRun) writeNote(vaultPath, outputRel, { body, frontmatter });
      imported.push({ path: outputRel, source_id: frontmatter.source_id });
    }
  } else if (stat.isDirectory()) {
    const files = [];
    walkMd(absInput, absInput, '', files);
    for (const { fullPath, relPath } of files) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const { frontmatter, body } = parseFrontmatterAndBody(content);
      const baseName = path.basename(relPath, '.md');
      const sourceId = frontmatter.source_id || frontmatter.id || `claude_${baseName}`;
      const merged = {
        ...frontmatter,
        source: 'claude',
        source_id: String(sourceId).slice(0, 128),
        date: frontmatter.date || now,
        ...(project && { project: normalizeSlug(project) }),
        ...(tags.length && { tags: [...new Set([...(Array.isArray(frontmatter.tags) ? frontmatter.tags : []), ...tags])] }),
      };
      const outputRel = path.join(outputBase, relPath).replace(/\\/g, '/');
      const clean = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined && v !== null && v !== ''));
      if (!dryRun) writeNote(vaultPath, outputRel, { body, frontmatter: clean });
      imported.push({ path: outputRel, source_id: merged.source_id });
    }
  } else {
    throw new Error('Claude export must be a folder of .md files or a .json file. Use a third-party exporter if needed.');
  }

  return { imported, count: imported.length };
}

function formatMessages(msgs) {
  if (!Array.isArray(msgs)) return '';
  return msgs
    .map((m) => {
      const role = m.role || m.type || 'unknown';
      const text = m.content || m.text || m.message || '';
      return `**${role}:**\n${text}`;
    })
    .join('\n\n');
}

function walkMd(rootDir, dir, relDir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      walkMd(rootDir, path.join(dir, e.name), rel, out);
    } else if (e.name.endsWith('.md')) {
      out.push({ fullPath: path.join(dir, e.name), relPath: rel.replace(/\\/g, '/') });
    }
  }
}
