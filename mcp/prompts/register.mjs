/**
 * Issue #1 Phase B — MCP prompts (registerKnowtationPrompts).
 * Prompt argument values are strings per MCP; coerce inside handlers.
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { loadConfig } from '../../lib/config.mjs';
import { runListNotes } from '../../lib/list-notes.mjs';
import { runSearch } from '../../lib/search.mjs';
import { readNote, normalizeSlug } from '../../lib/vault.mjs';
import { listNotesForCausalChainId } from '../resources/graph.mjs';
import {
  textContent,
  embeddedNoteFromPath,
  embeddedMarkdownResource,
  snippet,
  parseIntSafe,
  formatMemoryEventsAsync,
  MAX_EMBEDDED_NOTES,
  MAX_ENTITY_NOTES,
  PROJECT_SUMMARY_NOTES,
  CONTENT_PLAN_NOTES,
} from './helpers.mjs';

/** @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server */
export function registerKnowtationPrompts(server) {
  server.registerPrompt(
    'daily-brief',
    {
      title: 'Daily brief',
      description: 'Notes since a date (default today UTC) with snippets; assistant prefill for summarizing.',
      argsSchema: {
        date: z.string().optional().describe('YYYY-MM-DD; default today (UTC)'),
        project: z.string().optional().describe('Project slug'),
      },
    },
    async (args) => {
      const config = loadConfig();
      const since = (args.date && String(args.date).trim()) || new Date().toISOString().slice(0, 10);
      const out = runListNotes(config, {
        since,
        project: args.project || undefined,
        limit: 80,
        offset: 0,
        order: 'date',
        fields: 'full',
      });
      const notes = out.notes || [];
      const lines = notes.length
        ? notes.map((n, i) => {
            const title = n.frontmatter?.title || n.path;
            const d = n.frontmatter?.date || '';
            return `${i + 1}. **${title}** (${n.path}, ${d})\n   ${snippet(n.body, 240)}`;
          })
        : ['(No notes in range.)'];
      return {
        description: `Daily brief for notes since ${since}`,
        messages: [
          {
            role: 'user',
            content: textContent(
              'You are a personal knowledge assistant. Below are notes captured in the selected range. Summarize themes, decisions, and open threads.'
            ),
          },
          { role: 'user', content: textContent(lines.join('\n\n')) },
          { role: 'assistant', content: textContent('Here is your daily brief:') },
        ],
      };
    }
  );

  server.registerPrompt(
    'search-and-synthesize',
    {
      title: 'Search and synthesize',
      description: 'Semantic search then embed top notes for synthesis.',
      argsSchema: {
        query: z.string().describe('Search query'),
        project: z.string().optional().describe('Project slug'),
        limit: z.string().optional().describe('Max notes (default 10)'),
      },
    },
    async (args) => {
      const config = loadConfig();
      const limit = Math.min(20, Math.max(1, parseIntSafe(args.limit, 10)));
      const searchOut = await runSearch(String(args.query || ''), {
        limit,
        project: args.project || undefined,
        fields: 'path',
      });
      const paths = (searchOut.results || []).map((r) => r.path).filter(Boolean).slice(0, MAX_EMBEDDED_NOTES);
      const messages = [
        {
          role: 'user',
          content: textContent(
            `You have ${paths.length} top-matching vault notes below (semantic search for: "${String(args.query)}"). Synthesize key themes, agreements, and gaps. Cite paths when specific.`
          ),
        },
      ];
      for (const p of paths) {
        try {
          messages.push({ role: 'user', content: embeddedNoteFromPath(config, p) });
        } catch (_) {}
      }
      return { description: 'Search results embedded as resources', messages };
    }
  );

  server.registerPrompt(
    'project-summary',
    {
      title: 'Project summary',
      description: 'Recent project notes embedded for executive-style summary.',
      argsSchema: {
        project: z.string().describe('Project slug'),
        since: z.string().optional().describe('YYYY-MM-DD'),
        format: z.enum(['brief', 'detailed', 'stakeholder']).optional().describe('Summary style'),
      },
    },
    async (args) => {
      const config = loadConfig();
      const project = normalizeSlug(String(args.project || ''));
      if (!project) {
        return {
          messages: [{ role: 'user', content: textContent('Error: project argument is required.') }],
        };
      }
      const fmt = args.format || 'brief';
      const out = runListNotes(config, {
        project,
        since: args.since || undefined,
        limit: PROJECT_SUMMARY_NOTES,
        offset: 0,
        order: 'date',
        fields: 'full',
      });
      const notes = out.notes || [];
      const messages = [
        {
          role: 'user',
          content: textContent(
            `Produce a ${fmt} executive summary for project "${project}" using the embedded notes. Note count (sample): ${notes.length} of ${out.total} total matching filters.`
          ),
        },
      ];
      for (const n of notes.slice(0, MAX_EMBEDDED_NOTES)) {
        try {
          messages.push({ role: 'user', content: embeddedNoteFromPath(config, n.path) });
        } catch (_) {}
      }
      return { description: `Project summary (${project})`, messages };
    }
  );

  server.registerPrompt(
    'write-from-capture',
    {
      title: 'Write from capture',
      description: 'Format raw capture text into a proper vault note (optionally with capture template).',
      argsSchema: {
        raw_text: z.string().describe('Raw pasted text'),
        source: z.string().describe('e.g. telegram, whatsapp, email'),
        project: z.string().optional().describe('Project slug'),
      },
    },
    async (args) => {
      const config = loadConfig();
      const raw = String(args.raw_text ?? '');
      const source = String(args.source ?? 'unknown');
      const project = args.project ? normalizeSlug(String(args.project)) : null;
      const tryRel = 'templates/capture.md';
      const full = path.join(config.vault_path, tryRel);
      let templateHint = '';
      const messages = [
        {
          role: 'user',
          content: textContent(
            `Format the following raw capture into a Knowtation markdown note with YAML frontmatter: title, date (today if missing), source: "${source}", inbox-friendly tags if appropriate${project ? `, project: "${project}"` : ''}. Use clean body markdown.${templateHint}`
          ),
        },
      ];
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        try {
          const t = fs.readFileSync(full, 'utf8');
          templateHint = `\n\nA capture template is attached as an embedded resource (knowtation://vault/${tryRel}).`;
          messages[0].content = textContent(
            `Format the following raw capture into a Knowtation markdown note with YAML frontmatter: title, date (today if missing), source: "${source}", inbox-friendly tags if appropriate${project ? `, project: "${project}"` : ''}. Use clean body markdown.${templateHint}`
          );
          messages.push({
            role: 'user',
            content: embeddedMarkdownResource(`knowtation://vault/${tryRel}`, t),
          });
        } catch (_) {}
      }
      messages.push({ role: 'user', content: textContent(`--- Raw capture ---\n${raw.slice(0, 50000)}`) });
      return { description: 'Capture → vault note', messages };
    }
  );

  server.registerPrompt(
    'temporal-summary',
    {
      title: 'Temporal summary',
      description: 'Notes between two dates; optional semantic topic filter.',
      argsSchema: {
        since: z.string().describe('YYYY-MM-DD start'),
        until: z.string().describe('YYYY-MM-DD end'),
        topic: z.string().optional().describe('Optional semantic filter; runs search then intersects dates'),
        project: z.string().optional().describe('Project slug'),
      },
    },
    async (args) => {
      const config = loadConfig();
      const since = String(args.since || '').slice(0, 10);
      const until = String(args.until || '').slice(0, 10);
      let pathSet = null;
      if (args.topic && String(args.topic).trim()) {
        const so = await runSearch(String(args.topic), {
          limit: 80,
          project: args.project || undefined,
          fields: 'path',
        });
        pathSet = new Set((so.results || []).map((r) => r.path).filter(Boolean));
      }
      const out = runListNotes(config, {
        since,
        until,
        project: args.project || undefined,
        limit: 100,
        offset: 0,
        order: 'date-asc',
        fields: 'path+metadata',
      });
      let notes = out.notes || [];
      if (pathSet) {
        notes = notes.filter((n) => pathSet.has(n.path));
      }
      const lines = notes.map(
        (n, i) =>
          `${i + 1}. ${n.title || n.path} (${n.path}, ${n.date || ''})${n.tags?.length ? ` tags: ${n.tags.join(',')}` : ''}`
      );
      return {
        description: `Temporal view ${since} … ${until}`,
        messages: [
          {
            role: 'user',
            content: textContent(
              `What happened between ${since} and ${until}? What decisions were made? What changed? Use the note list below${args.topic ? ` (filtered by topic search)` : ''}.\n\n${lines.join('\n') || '(No notes in range.)'}`
            ),
          },
        ],
      };
    }
  );

  server.registerPrompt(
    'extract-entities',
    {
      title: 'Extract entities',
      description: 'Structured JSON extraction prompt over vault notes in scope.',
      argsSchema: {
        folder: z.string().optional(),
        project: z.string().optional(),
        entity_types: z.enum(['people', 'places', 'decisions', 'goals', 'all']).optional(),
      },
    },
    async (args) => {
      const config = loadConfig();
      const types = args.entity_types || 'all';
      const out = runListNotes(config, {
        folder: args.folder || undefined,
        project: args.project || undefined,
        limit: MAX_ENTITY_NOTES,
        offset: 0,
        fields: 'full',
      });
      const notes = out.notes || [];
      const messages = [
        {
          role: 'user',
          content: textContent(
            `Extract entities from the embedded notes. Output a single JSON object: { "people": [], "places": [], "decisions": [], "goals": [] } with short strings. Entity focus: ${types}. If a category is empty, use [].`
          ),
        },
      ];
      for (const n of notes.slice(0, MAX_EMBEDDED_NOTES)) {
        try {
          messages.push({ role: 'user', content: embeddedNoteFromPath(config, n.path) });
        } catch (_) {}
      }
      return { description: 'Entity extraction', messages };
    }
  );

  server.registerPrompt(
    'meeting-notes',
    {
      title: 'Meeting notes',
      description: 'Transcript → structured meeting note instructions.',
      argsSchema: {
        transcript: z.string().describe('Raw transcript'),
        attendees: z.string().optional().describe('Comma-separated names'),
        project: z.string().optional(),
        date: z.string().optional().describe('YYYY-MM-DD'),
      },
    },
    async (args) => {
      const attendees = String(args.attendees || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const project = args.project ? normalizeSlug(String(args.project)) : null;
      const date = args.date || new Date().toISOString().slice(0, 10);
      const t = String(args.transcript || '').slice(0, 100_000);
      const suggestedPath = project
        ? `projects/${project}/inbox/meeting-${date}.md`
        : `inbox/meeting-${date}.md`;
      return {
        description: 'Meeting note draft prompt',
        messages: [
          {
            role: 'user',
            content: textContent(
              `Convert the transcript into a vault meeting note with YAML frontmatter: title, date: ${date}, attendees: [${attendees.map((a) => `"${a}"`).join(', ')}]${project ? `, project: "${project}"` : ''}, tags. Body: agenda summary, decisions, action items (owners), follow-ups. Suggested path for write tool: ${suggestedPath}`
            ),
          },
          { role: 'user', content: textContent(`--- Transcript ---\n${t}`) },
        ],
      };
    }
  );

  server.registerPrompt(
    'knowledge-gap',
    {
      title: 'Knowledge gap',
      description: 'Given search hits, ask what is missing and what to capture next.',
      argsSchema: {
        query: z.string().describe('Topic / question'),
        project: z.string().optional(),
      },
    },
    async (args) => {
      const config = loadConfig();
      const so = await runSearch(String(args.query || ''), {
        limit: 15,
        project: args.project || undefined,
        fields: 'path+snippet',
      });
      const lines = (so.results || []).map(
        (r, i) => `${i + 1}. ${r.path}${r.snippet ? `\n   ${snippet(r.snippet, 200)}` : ''}`
      );
      return {
        description: 'Knowledge gap analysis',
        messages: [
          {
            role: 'user',
            content: textContent(
              `Given these vault search results for "${String(args.query)}", what is missing? What questions remain unanswered? What should I capture next?\n\n${lines.join('\n\n') || '(No results.)'}`
            ),
          },
        ],
      };
    }
  );

  server.registerPrompt(
    'causal-chain',
    {
      title: 'Causal chain',
      description: 'Notes sharing causal_chain_id, embedded in chronological order.',
      argsSchema: {
        chain_id: z.string().describe('Causal chain id / slug'),
        include_summaries: z.string().optional().describe('true to emphasize summaries edges'),
      },
    },
    async (args) => {
      const config = loadConfig();
      const notes = listNotesForCausalChainId(config, String(args.chain_id || ''));
      const inc = String(args.include_summaries || '').toLowerCase() === 'true';
      const messages = [
        {
          role: 'user',
          content: textContent(
            `Narrate the causal sequence for chain "${String(args.chain_id)}". Use follows / summarizes in frontmatter where present.${inc ? ' Pay special attention to summarization relationships.' : ''}`
          ),
        },
      ];
      for (const n of notes.slice(0, MAX_EMBEDDED_NOTES)) {
        try {
          messages.push({ role: 'user', content: embeddedNoteFromPath(config, n.path) });
        } catch (_) {}
      }
      if (notes.length === 0) {
        messages.push({
          role: 'user',
          content: textContent('(No notes found for this causal_chain_id.)'),
        });
      }
      return { description: `Causal chain ${args.chain_id}`, messages };
    }
  );

  server.registerPrompt(
    'content-plan',
    {
      title: 'Content plan',
      description: 'Content calendar / plan from recent project notes.',
      argsSchema: {
        project: z.string().describe('Project slug'),
        format: z.enum(['blog', 'podcast', 'newsletter', 'thread']).optional(),
        tone: z.string().optional(),
      },
    },
    async (args) => {
      const config = loadConfig();
      const project = normalizeSlug(String(args.project || ''));
      const fmt = args.format || 'blog';
      const tone = args.tone || 'clear, authoritative';
      const out = runListNotes(config, {
        project,
        limit: CONTENT_PLAN_NOTES,
        offset: 0,
        order: 'date',
        fields: 'full',
      });
      const notes = out.notes || [];
      const messages = [
        {
          role: 'user',
          content: textContent(
            `Create a ${fmt} content plan for project "${project}". Tone: ${tone}. Topics, order, angles, and what to write next. Ground in the embedded notes.`
          ),
        },
      ];
      for (const n of notes.slice(0, MAX_EMBEDDED_NOTES)) {
        try {
          messages.push({ role: 'user', content: embeddedNoteFromPath(config, n.path) });
        } catch (_) {}
      }
      return { description: `Content plan (${project})`, messages };
    }
  );

  server.registerPrompt(
    'memory-context',
    {
      title: 'Memory context',
      description: 'What has the agent been doing? Recent memory events formatted for context.',
      argsSchema: {
        limit: z.string().optional().describe('Max events (default 20)'),
        type: z.string().optional().describe('Filter by event type'),
      },
    },
    async (args) => {
      const config = loadConfig();
      const limit = parseIntSafe(args.limit, 20);
      const { text, count } = await formatMemoryEventsAsync(config, {
        limit,
        type: args.type || undefined,
      });
      return {
        description: `Memory context (${count} events)`,
        messages: [
          {
            role: 'user',
            content: textContent(
              `Below is a log of recent agent/user activity from the memory layer (${count} events). Use this to understand context, prior actions, and continuity.\n\n${text}`
            ),
          },
        ],
      };
    }
  );

  server.registerPrompt(
    'memory-informed-search',
    {
      title: 'Memory-informed search',
      description: 'Vault search augmented with memory context — what was searched before, what is new.',
      argsSchema: {
        query: z.string().describe('Search query'),
        limit: z.string().optional().describe('Max notes (default 10)'),
        project: z.string().optional(),
      },
    },
    async (args) => {
      const config = loadConfig();
      const limit = Math.min(20, Math.max(1, parseIntSafe(args.limit, 10)));
      const searchOut = await runSearch(String(args.query || ''), {
        limit,
        project: args.project || undefined,
        fields: 'path',
      });
      const paths = (searchOut.results || []).map((r) => r.path).filter(Boolean).slice(0, MAX_EMBEDDED_NOTES);
      const { text: memText, count: memCount } = await formatMemoryEventsAsync(config, {
        limit: 10,
        type: 'search',
      });
      const messages = [
        {
          role: 'user',
          content: textContent(
            `Search query: "${String(args.query)}"\n\n**Previous searches from memory** (${memCount} recent):\n${memText}\n\n**Current search results** (${paths.length} notes embedded below). Compare with past searches — highlight what is new or changed, and synthesize findings.`
          ),
        },
      ];
      for (const p of paths) {
        try {
          messages.push({ role: 'user', content: embeddedNoteFromPath(config, p) });
        } catch (_) {}
      }
      return { description: 'Memory-informed search', messages };
    }
  );

  server.registerPrompt(
    'resume-session',
    {
      title: 'Resume session',
      description: 'Pick up where you left off — recent memory events and session summaries.',
      argsSchema: {
        since: z.string().optional().describe('YYYY-MM-DD (default: last 24 hours)'),
      },
    },
    async (args) => {
      const config = loadConfig();
      const since = args.since || new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const { text: allText, count: allCount } = await formatMemoryEventsAsync(config, {
        limit: 30,
        since,
      });
      const { text: summaryText, count: summaryCount } = await formatMemoryEventsAsync(config, {
        limit: 5,
        type: 'session_summary',
        since,
      });
      const parts = [];
      if (summaryCount > 0) {
        parts.push(`**Session summaries** (${summaryCount}):\n${summaryText}`);
      }
      parts.push(`**Recent activity** (${allCount} events since ${since}):\n${allText}`);
      return {
        description: `Resume session (since ${since})`,
        messages: [
          {
            role: 'user',
            content: textContent(
              `Help me pick up where I left off. Below is my recent activity log and any session summaries. Summarize what was happening, what was accomplished, and suggest next steps.\n\n${parts.join('\n\n')}`
            ),
          },
        ],
      };
    }
  );
}
