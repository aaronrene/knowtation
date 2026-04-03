/**
 * Issue #1 Phase F3 — post-index enrichment via sampling.
 * Generates per-note summaries and writes them as frontmatter metadata.
 * Opt-in only (expensive: one sampling call per note).
 */

import { readNote, resolveVaultRelativePath } from '../../lib/vault.mjs';
import { writeNote } from '../../lib/write.mjs';
import { trySampling } from '../sampling.mjs';
import { completeChat } from '../../lib/llm-complete.mjs';

const SUMMARY_SYSTEM = 'Summarize the following note in 1-2 sentences. Be factual and concise. Output only the summary text, nothing else.';
const MAX_NOTE_CHARS = 16000;
const INTER_NOTE_DELAY_MS = 200;

/**
 * Enrich recently indexed notes by generating short summaries via sampling.
 * Summaries are written to frontmatter field `ai_summary`.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcpServer
 * @param {object} config - loadConfig() result
 * @param {{ limit?: number, onProgress?: (done: number, total: number) => Promise<void> }} [opts]
 * @returns {Promise<number>} count of notes enriched
 */
export async function enrichIndexedNotes(mcpServer, config, opts = {}) {
  const { runListNotes } = await import('../../lib/list-notes.mjs');
  const limit = Math.min(opts.limit ?? 50, 200);

  const listing = runListNotes(config, {
    limit,
    offset: 0,
    order: 'date',
    fields: 'full',
  });

  const notes = (listing.notes || []).filter((n) => {
    if (!n.path || !n.body) return false;
    if (n.frontmatter?.ai_summary) return false;
    return true;
  });

  let enriched = 0;
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    try {
      const body = note.body.slice(0, MAX_NOTE_CHARS);
      const userPrompt = `Note path: ${note.path}\n\n${body}`;

      let summary = await trySampling(mcpServer, {
        system: SUMMARY_SYSTEM,
        user: userPrompt,
        maxTokens: 200,
      });

      if (!summary) {
        try {
          summary = await completeChat(config, {
            system: SUMMARY_SYSTEM,
            user: userPrompt,
            maxTokens: 200,
          });
        } catch (_) {
          continue;
        }
      }

      if (summary) {
        writeNote(config.vault_path, note.path, {
          frontmatter: { ai_summary: summary.slice(0, 500) },
        });
        enriched++;
      }
    } catch (_) {
      // Skip individual note failures
    }

    if (opts.onProgress) {
      await opts.onProgress(i + 1, notes.length);
    }

    if (i < notes.length - 1 && INTER_NOTE_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, INTER_NOTE_DELAY_MS));
    }
  }

  return enriched;
}
