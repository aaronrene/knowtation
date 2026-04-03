/**
 * Issue #1 Phase C — enhanced MCP tools.
 */

import { z } from 'zod';
import path from 'path';
import { loadConfig } from '../../lib/config.mjs';
import { readNote, resolveVaultRelativePath, normalizeSlug } from '../../lib/vault.mjs';
import { runRelate } from '../../lib/relate.mjs';
import { runBacklinks } from '../../lib/backlinks.mjs';
import { runCaptureInbox } from '../../lib/capture-inbox.mjs';
import { transcribe } from '../../lib/transcribe.mjs';
import { writeNote } from '../../lib/write.mjs';
import { runVaultSync } from '../../lib/vault-git-sync.mjs';
import { completeChat } from '../../lib/llm-complete.mjs';
import { runExtractTasks } from '../../lib/extract-tasks.mjs';
import { runCluster } from '../../lib/cluster-semantic.mjs';
import { runTagSuggest } from '../../lib/tag-suggest.mjs';
import { trySampling } from '../sampling.mjs';

function jsonResponse(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] };
}

function jsonError(msg, code = 'ERROR') {
  return { content: [{ type: 'text', text: JSON.stringify({ error: msg, code }) }], isError: true };
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerPhaseCTools(server) {
  server.registerTool(
    'relate',
    {
      description: 'Find semantically related notes to a given note path (vector nearest neighbors, excluding self).',
      inputSchema: {
        path: z.string().describe('Vault-relative path to the source note (.md)'),
        limit: z.number().optional().describe('Max related notes (default 5, max 20)'),
        project: z.string().optional().describe('Filter neighbors by project slug'),
      },
    },
    async (args) => {
      try {
        const out = await runRelate(args.path, { limit: args.limit, project: args.project });
        return jsonResponse(out);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'backlinks',
    {
      description: 'List notes that wikilink to the target note ([[target]]).',
      inputSchema: {
        path: z.string().describe('Vault-relative path of the target note'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        return jsonResponse(runBacklinks(config, args.path));
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'capture',
    {
      description: 'Fast inbox capture: writes a new note under inbox/ (or projects/{project}/inbox/) with inbox frontmatter. No AIR check.',
      inputSchema: {
        text: z.string().describe('Note body text'),
        source: z.string().optional().describe('Source label (default mcp-capture)'),
        project: z.string().optional().describe('Optional project slug for project inbox'),
        tags: z.array(z.string()).optional().describe('Optional tags'),
      },
    },
    async (args) => {
      try {
        const out = runCaptureInbox(args.text, {
          source: args.source,
          project: args.project,
          tags: args.tags,
        });
        return jsonResponse(out);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'transcribe',
    {
      description: 'Transcribe an audio/video file (Whisper) and write the transcript to the vault.',
      inputSchema: {
        path: z.string().describe('Absolute path to audio/video file on disk'),
        project: z.string().optional(),
        tags: z.array(z.string()).optional(),
        output_path: z
          .string()
          .optional()
          .describe('Vault-relative .md path; default inbox auto-named from timestamp'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const text = await transcribe(args.path, { model: config.transcription?.model });
        const base = path.basename(args.path, path.extname(args.path)).replace(/[^a-z0-9-_]+/gi, '-').slice(0, 60) || 'transcript';
        const dateStr = new Date().toISOString().slice(0, 10);
        let rel = args.output_path;
        if (!rel) {
          const proj = args.project ? `projects/${normalizeSlug(String(args.project))}/inbox` : 'inbox';
          rel = `${proj}/${dateStr}-transcribe-${base}.md`;
        }
        const tagLine = args.tags?.length ? args.tags.join(', ') : undefined;
        const fm = { source: 'transcribe', date: dateStr, inbox: true };
        if (tagLine) fm.tags = tagLine;
        if (args.project) fm.project = args.project;
        const out = writeNote(config.vault_path, rel, { body: text, frontmatter: fm });
        return jsonResponse({ ...out, transcript_length: text.length, written: true });
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'vault_sync',
    {
      description: 'Git add, commit, and push the vault when vault.git.enabled and remote are configured.',
      inputSchema: {
        message: z.string().optional().describe('Ignored; commit message is auto-generated'),
      },
    },
    async () => {
      try {
        const config = loadConfig();
        const out = runVaultSync(config);
        return jsonResponse(out);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'summarize',
    {
      description:
        'Summarize one or more notes. When the MCP host supports sampling, uses the client LLM; otherwise OpenAI or Ollama on the server (OPENAI_API_KEY or Ollama + OLLAMA_CHAT_MODEL).',
      inputSchema: {
        path: z.string().optional().describe('Single vault-relative note path'),
        paths: z.array(z.string()).optional().describe('Multiple note paths'),
        style: z.enum(['brief', 'detailed', 'bullets']).optional(),
        max_words: z.number().optional(),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const paths = [];
        if (args.path) paths.push(args.path);
        if (args.paths?.length) paths.push(...args.paths);
        if (!paths.length) return jsonError('Provide path or paths', 'INVALID');
        const chunks = [];
        for (const p of paths) {
          resolveVaultRelativePath(config.vault_path, p);
          const n = readNote(config.vault_path, p);
          chunks.push(`## ${p}\n${n.body || ''}`);
        }
        const combined = chunks.join('\n\n').slice(0, 48000);
        const style = args.style || 'brief';
        const mw = args.max_words ?? (style === 'detailed' ? 400 : style === 'bullets' ? 300 : 150);
        const system = `You summarize vault notes faithfully. Output style: ${style}. Max approximately ${mw} words.`;
        const user = `Summarize the following markdown note(s):\n\n${combined}`;
        const maxTokens = Math.min(1024, Math.floor(mw * 2));
        let summary = await trySampling(server, { system, user, maxTokens });
        if (summary == null) {
          summary = await completeChat(config, { system, user, maxTokens });
        }
        return jsonResponse({ summary, source_paths: paths.map((p) => p.replace(/\\/g, '/')) });
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'extract_tasks',
    {
      description: 'Extract Markdown checkbox tasks (- [ ] / - [x]) from notes with optional filters.',
      inputSchema: {
        folder: z.string().optional(),
        project: z.string().optional(),
        tag: z.string().optional(),
        since: z.string().optional().describe('YYYY-MM-DD'),
        status: z.enum(['open', 'done', 'all']).optional(),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        return jsonResponse(runExtractTasks(config, args));
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'cluster',
    {
      description: 'Cluster notes by embedding truncated content (k-means). Sample size capped at 200 notes.',
      inputSchema: {
        project: z.string().optional(),
        folder: z.string().optional(),
        n_clusters: z.number().optional().describe('Number of clusters (default 5, max 15)'),
      },
    },
    async (args) => {
      try {
        const out = await runCluster(args);
        return jsonResponse(out);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'tag_suggest',
    {
      description: 'Suggest tags from semantically similar notes (requires indexed vault).',
      inputSchema: {
        path: z.string().optional().describe('Vault-relative note path'),
        body: z.string().optional().describe('Raw markdown/text if no path'),
      },
    },
    async (args) => {
      try {
        if (!args.path && !args.body) return jsonError('Provide path or body', 'INVALID');
        const out = await runTagSuggest({ path: args.path, body: args.body });
        return jsonResponse(out);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );
}
