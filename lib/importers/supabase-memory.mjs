/**
 * Import memories from a Supabase table into the Knowtation memory event log
 * and optionally as vault notes.
 *
 * Input: JSON config string or file with { url, key, table?, vault_notes? }
 * Or CLI: knowtation import supabase-memory '{"url":"...","key":"..."}'
 */

import fs from 'fs';
import path from 'path';
import { writeNote } from '../write.mjs';
import { normalizeSlug } from '../vault.mjs';

/**
 * @param {string} input — JSON string or path to JSON config file
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean, onMemoryEvent?: Function }} ctx
 * @returns {Promise<{ imported: { path: string, source_id?: string }[], count: number }>}
 */
export async function importSupabaseMemory(input, ctx) {
  const { vaultPath, outputBase, project, tags, dryRun, onMemoryEvent } = ctx;

  let opts;
  try {
    if (fs.existsSync(input) && fs.statSync(input).isFile()) {
      opts = JSON.parse(fs.readFileSync(input, 'utf8'));
    } else {
      opts = JSON.parse(input);
    }
  } catch (e) {
    throw new Error(`Invalid supabase-memory input. Provide JSON: {"url":"...","key":"..."}. Error: ${e.message}`);
  }

  const { url, key, table, vault_notes } = opts;
  if (!url || !key) {
    throw new Error('supabase-memory import requires "url" and "key" in the input JSON.');
  }

  const tableName = table || 'memories';
  const writeVaultNotes = vault_notes !== false;

  let createClient;
  try {
    const mod = await import('@supabase/supabase-js');
    createClient = mod.createClient;
  } catch (_) {
    throw new Error('supabase-memory import requires @supabase/supabase-js. Run: npm install @supabase/supabase-js');
  }

  const client = createClient(url, key);

  const PAGE_SIZE = 500;
  const imported = [];
  let offset = 0;
  const now = new Date().toISOString().slice(0, 10);

  while (true) {
    const { data: rows, error } = await client
      .from(tableName)
      .select('*')
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const body = row.memory || row.content || row.text || JSON.stringify(row);
      const memId = row.id || row.memory_id || `sb_${offset + imported.length}`;
      const sourceId = String(memId).slice(0, 128);
      const date = row.created_at || row.updated_at || now;
      const d = typeof date === 'number'
        ? new Date(date * 1000).toISOString().slice(0, 10)
        : String(date).slice(0, 10);

      let outputRel = null;
      if (writeVaultNotes) {
        const safeName = `supabase_${String(memId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}`;
        outputRel = path.join(outputBase, `${safeName}.md`).replace(/\\/g, '/');

        const frontmatter = {
          source: 'supabase',
          source_id: sourceId,
          date: d,
          ...(project && { project: normalizeSlug(project) }),
          ...(tags.length && { tags }),
        };

        if (!dryRun) writeNote(vaultPath, outputRel, { body: String(body).trim(), frontmatter });
      }

      imported.push({ path: outputRel || sourceId, source_id: sourceId });

      if (!dryRun && typeof onMemoryEvent === 'function') {
        try {
          onMemoryEvent({
            source: 'supabase',
            source_id: sourceId,
            date: d,
            text: String(body).trim().slice(0, 500),
            path: outputRel,
          });
        } catch (_) {}
      }
    }

    offset += rows.length;
    if (rows.length < PAGE_SIZE) break;
  }

  return { imported, count: imported.length };
}
