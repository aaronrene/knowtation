/**
 * Mem0 export importer. Path to Mem0 export JSON; one note per memory.
 * Requires Mem0 export file format (Pydantic-style or API response).
 */

import fs from 'fs';
import path from 'path';
import { writeNote } from '../write.mjs';
import { normalizeSlug } from '../vault.mjs';

/**
 * @param {string} input - Path to Mem0 export JSON
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean }} ctx
 * @returns {Promise<{ imported: { path: string, source_id?: string }[], count: number }>}
 */
export async function importMem0(input, ctx) {
  const { vaultPath, outputBase, project, tags, dryRun } = ctx;
  const absInput = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  if (!fs.existsSync(absInput) || !fs.statSync(absInput).isFile()) {
    throw new Error(`Mem0 export file not found: ${input}`);
  }

  const raw = fs.readFileSync(absInput, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid Mem0 export JSON: ${e.message}`);
  }

  const memories = Array.isArray(data) ? data : (data.memories || data.results || []);
  const imported = [];
  const now = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < memories.length; i++) {
    const m = memories[i];
    const body = m.memory || m.content || m.text || JSON.stringify(m);
    const memId = m.id || m.memory_id || m.metadata?.id || `mem0_${i}`;
    const sourceId = String(memId).slice(0, 128);
    const date = m.created_at || m.updated_at || m.metadata?.created_at || now;
    const d = typeof date === 'number' ? new Date(date * 1000).toISOString().slice(0, 10) : String(date).slice(0, 10);
    const safeName = `mem0_${String(memId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}`;
    const outputRel = path.join(outputBase, `${safeName}.md`).replace(/\\/g, '/');

    const frontmatter = {
      source: 'mem0',
      source_id: sourceId,
      date: d,
      ...(project && { project: normalizeSlug(project) }),
      ...(tags.length && { tags }),
    };

    if (!dryRun) writeNote(vaultPath, outputRel, { body: String(body).trim(), frontmatter });
    imported.push({ path: outputRel, source_id: sourceId });
  }

  return { imported, count: imported.length };
}
