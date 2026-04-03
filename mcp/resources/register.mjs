/**
 * Register Issue #1 Phase A MCP resources on an McpServer instance.
 */

import fs from 'fs';
import path from 'path';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from '../../lib/config.mjs';
import { readNote, resolveVaultRelativePath } from '../../lib/vault.mjs';
import { buildVaultListing, listMediaFiles, listTemplateFiles } from './listing.mjs';
import { noteToMarkdown } from './note.mjs';
import {
  buildIndexStats,
  buildTagsResource,
  buildProjectsResource,
  redactConfig,
  buildMemoryResource,
  buildMemorySummaryResource,
  buildMemoryEventsResource,
  buildMemoryTypeResource,
  buildAirLogResource,
} from './metadata.mjs';
import { buildKnowledgeGraph } from './graph.mjs';

function jsonContent(uri, obj) {
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType: 'application/json',
        text: JSON.stringify(obj, null, 2),
      },
    ],
  };
}

function textContent(uri, mimeType, text) {
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType,
        text,
      },
    ],
  };
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerKnowtationResources(server) {
  server.server.registerCapabilities({
    resources: { subscribe: true },
  });

  server.registerResource(
    'vault-root-listing',
    'knowtation://vault/',
    {
      title: 'Vault listing (all notes)',
      description: 'JSON list of notes under the vault (paginated, max 500 per request).',
    },
    async (uri) => {
      const config = loadConfig();
      return jsonContent(uri, buildVaultListing(config, ''));
    }
  );

  server.registerResource(
    'vault-inbox-listing',
    'knowtation://vault/inbox',
    {
      title: 'Inbox listing',
      description: 'JSON list of notes under vault/inbox/.',
    },
    async (uri) => {
      const config = loadConfig();
      return jsonContent(uri, buildVaultListing(config, 'inbox'));
    }
  );

  server.registerResource(
    'vault-captures-listing',
    'knowtation://vault/captures',
    {
      title: 'Captures listing',
      description: 'JSON list of notes under vault/captures/ (if present).',
    },
    async (uri) => {
      const config = loadConfig();
      return jsonContent(uri, buildVaultListing(config, 'captures'));
    }
  );

  server.registerResource(
    'vault-imports-listing',
    'knowtation://vault/imports',
    {
      title: 'Imports listing',
      description: 'JSON list of notes under vault/imports/ (if present).',
    },
    async (uri) => {
      const config = loadConfig();
      return jsonContent(uri, buildVaultListing(config, 'imports'));
    }
  );

  server.registerResource(
    'vault-media-audio',
    'knowtation://vault/media/audio',
    {
      title: 'Audio media files',
      description: 'JSON list of audio files under vault/media/audio/.',
    },
    async (uri) => {
      const config = loadConfig();
      return jsonContent(
        uri,
        listMediaFiles(config.vault_path, 'media/audio', ['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac', '.webm'])
      );
    }
  );

  server.registerResource(
    'vault-media-video',
    'knowtation://vault/media/video',
    {
      title: 'Video media files',
      description: 'JSON list of video files under vault/media/video/.',
    },
    async (uri) => {
      const config = loadConfig();
      return jsonContent(
        uri,
        listMediaFiles(config.vault_path, 'media/video', ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'])
      );
    }
  );

  server.registerResource(
    'vault-templates-index',
    'knowtation://vault/templates',
    {
      title: 'Template paths',
      description: 'List of markdown templates under vault/templates/.',
    },
    async (uri) => {
      const config = loadConfig();
      return jsonContent(uri, listTemplateFiles(config.vault_path));
    }
  );

  server.registerResource(
    'index-stats',
    'knowtation://index/stats',
    {
      title: 'Index statistics',
      description: 'Note count, chunk count in vector store, embedding config.',
    },
    async (uri) => {
      const config = loadConfig();
      const stats = await buildIndexStats(config);
      return jsonContent(uri, stats);
    }
  );

  server.registerResource(
    'index-tags',
    'knowtation://tags',
    {
      title: 'Tag facets',
      description: 'All tags with counts and projects.',
    },
    async (uri) => {
      const config = loadConfig();
      return jsonContent(uri, buildTagsResource(config));
    }
  );

  server.registerResource(
    'index-projects',
    'knowtation://projects',
    {
      title: 'Project manifest',
      description: 'Projects inferred from notes with note counts.',
    },
    async (uri) => {
      const config = loadConfig();
      return jsonContent(uri, buildProjectsResource(config));
    }
  );

  server.registerResource(
    'config-snapshot',
    'knowtation://config',
    {
      title: 'Redacted config',
      description: 'Non-secret config snapshot for agents.',
    },
    async (uri) => {
      const config = loadConfig();
      return jsonContent(uri, redactConfig(config));
    }
  );

  server.registerResource(
    'memory-last-search',
    'knowtation://memory/last_search',
    {
      title: 'Last search (memory)',
      description: 'Last stored search query and paths when memory.enabled.',
    },
    async (uri) => {
      const config = loadConfig();
      return jsonContent(uri, buildMemoryResource(config, 'last_search'));
    }
  );

  server.registerResource(
    'memory-last-export',
    'knowtation://memory/last_export',
    {
      title: 'Last export (memory)',
      description: 'Last export provenance when memory.enabled.',
    },
    async (uri) => {
      const config = loadConfig();
      return jsonContent(uri, buildMemoryResource(config, 'last_export'));
    }
  );

  server.registerResource(
    'memory-summary',
    'knowtation://memory/',
    {
      title: 'Memory summary',
      description: 'Memory layer status: enabled, provider, event counts, last activity.',
    },
    async (uri) => {
      const config = loadConfig();
      return jsonContent(uri, buildMemorySummaryResource(config));
    }
  );

  server.registerResource(
    'memory-events',
    'knowtation://memory/events',
    {
      title: 'Recent memory events',
      description: 'Last 50 memory events from the event log.',
    },
    async (uri) => {
      const config = loadConfig();
      return jsonContent(uri, buildMemoryEventsResource(config));
    }
  );

  server.registerResource(
    'air-log',
    'knowtation://air/log',
    {
      title: 'AIR attestation log',
      description: 'Placeholder until AIR ids are persisted (see docs/MCP-RESOURCES-PHASE-A.md).',
    },
    async (uri) => {
      return jsonContent(uri, buildAirLogResource());
    }
  );

  server.registerResource(
    'index-graph',
    'knowtation://index/graph',
    {
      title: 'Knowledge graph',
      description: 'Nodes (notes) and edges (wikilinks, follows, summarizes, causal_chain).',
    },
    async (uri) => {
      const config = loadConfig();
      return jsonContent(uri, buildKnowledgeGraph(config));
    }
  );

  const templateNoteUri = new ResourceTemplate('knowtation://vault/templates/{+name}', {
    list: async () => {
      const config = loadConfig();
      const { templates } = listTemplateFiles(config.vault_path);
      const resources = templates.map((rel) => {
        const name = rel.replace(/^templates\//, '');
        const uri = `knowtation://vault/templates/${name}`;
        return {
          uri,
          name: name.split('/').pop() || name,
          mimeType: 'text/markdown',
          description: `Template: ${name}`,
        };
      });
      return { resources };
    },
  });

  server.registerResource(
    'vault-template-file',
    templateNoteUri,
    {
      title: 'Vault template',
      description: 'Markdown template under vault/templates/.',
    },
    async (uri, variables) => {
      const config = loadConfig();
      let name = variables.name;
      if (Array.isArray(name)) name = name[0];
      name = decodeURIComponent(String(name || '').replace(/\\/g, '/'));
      if (!name || name.includes('..')) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid template name');
      }
      let rel = `templates/${name}`;
      if (!rel.endsWith('.md')) rel = `${rel}.md`;
      const full = path.join(config.vault_path, rel);
      if (!full.startsWith(path.resolve(config.vault_path)) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
        throw new McpError(ErrorCode.InvalidParams, `Template not found: ${name}`);
      }
      const body = fs.readFileSync(full, 'utf8');
      return textContent(uri, 'text/markdown', body);
    }
  );

  const vaultPathTemplate = new ResourceTemplate('knowtation://vault/{+path}', {
    list: async () => {
      const config = loadConfig();
      const { listMarkdownFiles } = await import('../../lib/vault.mjs');
      const paths = listMarkdownFiles(config.vault_path, { ignore: config.ignore });
      const resources = paths.slice(0, 500).map((p) => {
        const u = `knowtation://vault/${p}`;
        let title = p.split('/').pop() || p;
        let description = '';
        try {
          const n = readNote(config.vault_path, p);
          title = n.frontmatter?.title || title;
          description = (n.body || '').slice(0, 160).replace(/\s+/g, ' ').trim();
        } catch (_) {}
        return {
          uri: u,
          name: title,
          mimeType: 'text/markdown',
          description: description || undefined,
        };
      });
      return { resources };
    },
  });

  server.registerResource(
    'vault-path',
    vaultPathTemplate,
    {
      title: 'Vault note or listing',
      description: 'Markdown note if path ends with .md; otherwise JSON listing for that folder prefix.',
    },
    async (uri, variables) => {
      const config = loadConfig();
      let rel = variables.path;
      if (Array.isArray(rel)) rel = rel[0];
      rel = decodeURIComponent(String(rel || '').replace(/\\/g, '/'));
      if (rel.includes('..')) {
        throw new McpError(ErrorCode.InvalidParams, 'Invalid path');
      }

      if (rel.endsWith('.md')) {
        resolveVaultRelativePath(config.vault_path, rel);
        const note = readNote(config.vault_path, rel);
        const title = note.frontmatter?.title || rel.split('/').pop();
        const desc = (note.body || '').slice(0, 160).replace(/\s+/g, ' ').trim();
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: 'text/markdown',
              text: noteToMarkdown(note),
              _meta: { title, description: desc },
            },
          ],
        };
      }

      return jsonContent(uri, buildVaultListing(config, rel));
    }
  );
}
