/**
 * MCP Attachment read tools — attachment_list / attachment_get (Phase 2F-b-b).
 *
 * @see docs/ATTACHMENT-STORE-CONTRACT-2F-b.md §5.2
 */

import { z } from 'zod';
import { loadConfig } from '../../lib/config.mjs';
import {
  handleAttachmentListRequest,
  handleAttachmentGetRequest,
} from '../../lib/attachments/attachment-handlers.mjs';
import {
  handleMediaLinkProposeRequest,
  handleMediaAttachProposeRequest,
  handleMediaImportConsentListRequest,
} from '../../lib/attachments/attachment-write.mjs';
import { createProposal } from '../../hub/proposals-store.mjs';
import { jsonResponse, jsonError } from '../create-server.mjs';

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerAttachmentTools(server) {
  server.registerTool(
    'attachment_list',
    {
      description:
        'List scope-visible attachments (content-minimized summaries). Same JSON as Hub GET /api/v1/attachments.',
      inputSchema: {
        scope: z.enum(['personal', 'project', 'org']).optional().describe('Narrow within authorized scopes only'),
        note_ref: z.string().optional().describe('Filter attachments linked to note:path'),
        source: z
          .enum(['vault_file', 'mist_blob', 'embedded_url', 'connector_ref'])
          .optional()
          .describe('Filter by derivation source'),
        mime_class: z
          .enum(['image', 'video', 'audio', 'document', 'unknown'])
          .optional()
          .describe('Filter by mime class'),
        storage_kind: z.enum(['vault_blob', 'external_link']).optional().describe('Filter storage kind'),
        agent_visible: z.boolean().optional().describe('When true, only agent-visible attachments'),
        limit: z.number().int().min(1).max(500).optional().describe('Max summaries (default 500)'),
        vault_id: z.string().optional().describe('Vault id (default from config)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const cliScopes = Array.isArray(config.flow?.visible_scopes)
          ? config.flow.visible_scopes
          : undefined;
        const result = handleAttachmentListRequest({
          dataDir: config.data_dir,
          vaultPath: config.vault_path,
          vaultId,
          cliScopes,
          scope: args.scope,
          note_ref: args.note_ref,
          source: args.source,
          mime_class: args.mime_class,
          storage_kind: args.storage_kind,
          agent_visible: args.agent_visible,
          limit: args.limit,
          vaultConfig: { ignore: config.ignore },
        });
        if (!result.ok) {
          return jsonError(result.error, result.code);
        }
        return jsonResponse(result.payload);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    },
  );

  server.registerTool(
    'attachment_get',
    {
      description:
        'Get one authorized attachment record. Same JSON as Hub GET /api/v1/attachments/{id}.',
      inputSchema: {
        attachment_id: z.string().describe('Attachment id (att_<tag>_<32hex>)'),
        vault_id: z.string().optional().describe('Vault id (default from config)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const cliScopes = Array.isArray(config.flow?.visible_scopes)
          ? config.flow.visible_scopes
          : undefined;
        const result = handleAttachmentGetRequest({
          dataDir: config.data_dir,
          vaultPath: config.vault_path,
          vaultId,
          attachmentId: args.attachment_id,
          cliScopes,
          vaultConfig: { ignore: config.ignore },
        });
        if (!result.ok) {
          return jsonError(result.error, result.code);
        }
        return jsonResponse(result.payload);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    },
  );

  server.registerTool(
    'media_external_link_propose',
    {
      description:
        'Propose linking an external media reference (review-before-write). Same JSON as Hub POST /api/v1/attachments/link-proposals.',
      inputSchema: {
        intent: z.string().describe('Human-readable reason (recorded, never executed)'),
        scope: z.enum(['personal', 'project', 'org']),
        connector_id: z.string().describe('Allowlisted connector id'),
        opaque_ref: z.string().describe('Connector-scoped opaque handle (never fetched)'),
        consent_id: z.string().describe('Active import consent id (mic_…)'),
        display_label: z.string().optional(),
        vault_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const cliScopes = Array.isArray(config.flow?.visible_scopes)
          ? config.flow.visible_scopes
          : undefined;
        const result = await handleMediaLinkProposeRequest({
          dataDir: config.data_dir,
          vaultPath: config.vault_path,
          vaultId,
          cliScopes,
          intent: args.intent,
          body: {
            scope: args.scope,
            connector_id: args.connector_id,
            opaque_ref: args.opaque_ref,
            consent_id: args.consent_id,
            display_label: args.display_label,
          },
          createProposal,
          vaultConfig: { ignore: config.ignore },
        });
        if (!result.ok) {
          return jsonError(result.error, result.code);
        }
        return jsonResponse(result.payload);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    },
  );

  server.registerTool(
    'media_attach_propose',
    {
      description:
        'Propose attaching media to a note (review-before-write). Same JSON as Hub POST /api/v1/attachments/attach-proposals.',
      inputSchema: {
        intent: z.string(),
        scope: z.enum(['personal', 'project', 'org']),
        attachment_id: z.string(),
        note_ref: z.string().describe('Target note ref (note:path)'),
        base_state_id: z.string().describe('Target note kn1_ concurrency token'),
        vault_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const cliScopes = Array.isArray(config.flow?.visible_scopes)
          ? config.flow.visible_scopes
          : undefined;
        const result = await handleMediaAttachProposeRequest({
          dataDir: config.data_dir,
          vaultPath: config.vault_path,
          vaultId,
          cliScopes,
          intent: args.intent,
          body: {
            scope: args.scope,
            attachment_id: args.attachment_id,
            note_ref: args.note_ref,
            base_state_id: args.base_state_id,
          },
          createProposal,
          vaultConfig: { ignore: config.ignore },
        });
        if (!result.ok) {
          return jsonError(result.error, result.code);
        }
        return jsonResponse(result.payload);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    },
  );

  server.registerTool(
    'media_import_consent_list',
    {
      description:
        'List import consents for external media linking (read-only). Same JSON as Hub GET /api/v1/attachments/import-consents.',
      inputSchema: {
        scope: z.enum(['personal', 'project', 'org']).optional(),
        vault_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const cliScopes = Array.isArray(config.flow?.visible_scopes)
          ? config.flow.visible_scopes
          : undefined;
        const result = handleMediaImportConsentListRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          scope: args.scope,
        });
        if (!result.ok) {
          return jsonError(result.error, result.code);
        }
        return jsonResponse(result.payload);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    },
  );
}
