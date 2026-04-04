/**
 * Issue #1 Phase F2 — enrich tool: auto-tag, categorize, and title via sampling (or server LLM).
 */

import { z } from 'zod';
import { loadConfig } from '../../lib/config.mjs';
import { readNote, resolveVaultRelativePath } from '../../lib/vault.mjs';
import { writeNote } from '../../lib/write.mjs';
import { completeChat } from '../../lib/llm-complete.mjs';
import { trySamplingJson } from '../sampling.mjs';

function jsonResponse(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] };
}

function jsonError(msg, code = 'ERROR') {
  return { content: [{ type: 'text', text: JSON.stringify({ error: msg, code }) }], isError: true };
}

const ENRICH_SYSTEM = `You are a knowledge management assistant. Given a note's content, suggest metadata.
Return ONLY a JSON object with these fields:
- "title": a concise descriptive title (string)
- "project": a lowercase-kebab-case project slug, or null if unclear (string|null)
- "tags": up to 5 relevant tags as an array of lowercase strings (string[])

Base suggestions on the actual content. Do not invent information not present in the note.`;

/**
 * Parse the LLM response (JSON) into a normalized suggestions object.
 * @param {string} raw
 * @returns {{ title: string|null, project: string|null, tags: string[] }}
 */
function parseEnrichResponse(raw) {
  const fallback = { title: null, project: null, tags: [] };
  if (!raw) return fallback;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const obj = JSON.parse(cleaned);
    return {
      title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : null,
      project: typeof obj.project === 'string' && obj.project.trim() ? obj.project.trim().toLowerCase().replace(/\s+/g, '-') : null,
      tags: Array.isArray(obj.tags)
        ? obj.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().toLowerCase()).slice(0, 10)
        : [],
    };
  } catch (_) {
    return fallback;
  }
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerEnrichTool(server) {
  server.registerTool(
    'enrich',
    {
      description:
        'Auto-categorize a note: suggest project, tags, and title via sampling (client LLM) or server LLM. Optionally apply suggestions to frontmatter.',
      inputSchema: {
        path: z.string().describe('Vault-relative note path'),
        apply: z.boolean().optional().describe('Write suggestions to frontmatter (default false, dry-run)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        resolveVaultRelativePath(config.vault_path, args.path);
        const note = readNote(config.vault_path, args.path);
        const body = (note.body || '').slice(0, 32000);
        const existingFm = note.frontmatter || {};
        const userPrompt = `Enrich the following note. Existing frontmatter: ${JSON.stringify(existingFm)}\n\n---\n${body}`;

        const samplingResult = await trySamplingJson(server, {
          system: ENRICH_SYSTEM,
          user: userPrompt,
          maxTokens: 512,
        });

        let suggestions;
        if (samplingResult) {
          suggestions = {
            title: typeof samplingResult.title === 'string' && samplingResult.title.trim() ? samplingResult.title.trim() : null,
            project: typeof samplingResult.project === 'string' && samplingResult.project.trim()
              ? samplingResult.project.trim().toLowerCase().replace(/\s+/g, '-') : null,
            tags: Array.isArray(samplingResult.tags)
              ? samplingResult.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().toLowerCase()).slice(0, 10)
              : [],
          };
        } else {
          const raw = await completeChat(config, {
            system: ENRICH_SYSTEM + '\n\nRespond ONLY with valid JSON. No markdown fences, no explanation.',
            user: userPrompt,
            maxTokens: 512,
          });
          suggestions = parseEnrichResponse(raw);
        }

        let applied = false;
        if (args.apply) {
          const fm = {};
          if (suggestions.title && !existingFm.title) fm.title = suggestions.title;
          if (suggestions.project && !existingFm.project) fm.project = suggestions.project;
          if (suggestions.tags.length > 0) {
            const existingTags = typeof existingFm.tags === 'string'
              ? existingFm.tags.split(',').map((t) => t.trim().toLowerCase())
              : Array.isArray(existingFm.tags) ? existingFm.tags.map((t) => String(t).trim().toLowerCase()) : [];
            const merged = [...new Set([...existingTags, ...suggestions.tags])];
            fm.tags = merged.join(', ');
          }
          if (Object.keys(fm).length > 0) {
            writeNote(config.vault_path, args.path, { frontmatter: fm });
            applied = true;
          }
        }

        return jsonResponse({
          path: args.path.replace(/\\/g, '/'),
          suggestions,
          applied,
          source: samplingResult ? 'sampling' : 'server-llm',
        });
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );
}

export { parseEnrichResponse, ENRICH_SYSTEM };
