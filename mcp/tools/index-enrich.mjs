/**
 * Issue #1 Phase F3 — post-index enrichment via sampling.
 * Generates per-note summaries and writes them as frontmatter metadata.
 * Opt-in only (expensive: one sampling call per note).
 *
 * Phase 6 migration (D6.6.2): all persistence now routes through DerivedArtifactWriter.
 * The direct writeNote call is removed. A writer must be supplied by the caller or built
 * internally from config (convenience/self-partition default).
 */

import { readNote, resolveVaultRelativePath } from '../../lib/vault.mjs';
import { writeNote } from '../../lib/write.mjs';
import { trySampling } from '../sampling.mjs';
import { completeChat } from '../../lib/llm-complete.mjs';
import {
  createDerivedArtifactWriter,
} from '../../lib/companion-artifact-writer.mjs';
import {
  buildConvenienceProvenance,
  PROVENANCE_SCHEMA_VERSION,
} from '../../lib/companion-provenance-validator.mjs';

const SUMMARY_SYSTEM = 'Summarize the following note in 1-2 sentences. Be factual and concise. Output only the summary text, nothing else.';
const MAX_NOTE_CHARS = 16000;
const INTER_NOTE_DELAY_MS = 200;

/**
 * Build a DerivedArtifactWriter from a config object for the convenience/self-partition default.
 * Used when the caller does not supply an explicit writer.
 *
 * @param {object} config - loadConfig() result
 * @returns {import('../../lib/companion-artifact-writer.mjs').DerivedArtifactWriter}
 */
function _buildDefaultWriter(config) {
  return createDerivedArtifactWriter({
    writeNoteFn: writeNote,
    vaultPath: config.vault_path,
    vaultRegistryAvailable: false, // convenience-only until vault registry exists
  });
}

/**
 * Build the write context for the convenience/self-partition default.
 * All enrichment here is self-partition (no delegation).
 *
 * @returns {import('../../lib/companion-artifact-writer.mjs').WriteContext}
 */
function _defaultWriteContext() {
  return {
    lane: 'local',
    containsPrivateData: false,
    isDelegate: false,
    delegatedManagedAllowed: false,
    enrichesDelegatedPartition: false,
    delegatedEnrichmentAllowed: false,
  };
}

/**
 * Enrich recently indexed notes by generating short summaries via sampling.
 * Summaries are written to frontmatter field `ai_summary` via DerivedArtifactWriter.
 *
 * Phase 6: persistence is routed through the writer (D6.6.2).
 * The writer performs provenance validation, tier resolution, consent gate, and
 * encryption routing before any write occurs. For the convenience/self-partition
 * default the behavior is unchanged — the writer passes all gates and stores
 * host-readable frontmatter exactly as before.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcpServer
 * @param {object} config - loadConfig() result
 * @param {{
 *   limit?: number,
 *   onProgress?: (done: number, total: number) => Promise<void>,
 *   writer?: import('../../lib/companion-artifact-writer.mjs').DerivedArtifactWriter,
 *   writerContext?: import('../../lib/companion-artifact-writer.mjs').WriteContext,
 *   generatedBy?: string,
 *   model?: string,
 *   modelVersion?: string,
 *   runtimeVersion?: string,
 * }} [opts]
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

  const writer = opts.writer ?? _buildDefaultWriter(config);
  const context = opts.writerContext ?? _defaultWriteContext();
  const generatedBy = opts.generatedBy || config.vault_id || 'system';
  const model = opts.model || config.llm?.model || 'unknown';
  // D6.2.1: one of model_version|runtime_version MUST be a concrete value.
  // When no version is configured, use 'unknown' rather than null to satisfy this.
  const modelVersion = opts.modelVersion || config.llm?.model_version || 'unknown';
  const runtimeVersion = opts.runtimeVersion || null;

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
        const truncatedSummary = summary.slice(0, 500);
        const sourceEventId = `enrich-${note.path}-${Date.now()}`;

        const provenance = buildConvenienceProvenance({
          generatedBy,
          source: 'companion',
          model,
          modelVersion: modelVersion ?? undefined,
          runtimeVersion: runtimeVersion ?? undefined,
          lane: context.lane,
          artifactType: 'ai_summary',
          sourceNotePath: note.path,
          sourceEventId,
        });

        const artifact = { summary: truncatedSummary };
        const result = await writer.write(artifact, provenance, context);

        if (result.ok) {
          enriched++;
        }
      }
    } catch (_) {
      // Skip individual note failures — same as before
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
