/**
 * ChatGPT (OpenAI) export importer. Parses conversations.json from export ZIP or folder.
 * One note per conversation; frontmatter: source: chatgpt, source_id, date, title.
 */

import fs from 'fs';
import path from 'path';
import { writeNote } from '../write.mjs';
import { normalizeSlug } from '../vault.mjs';

/**
 * @param {string} input - Path to ZIP or folder containing conversations.json
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean }} ctx
 * @returns {Promise<{ imported: { path: string, source_id?: string }[], count: number }>}
 */
export async function importChatGPT(input, ctx) {
  const { vaultPath, outputBase, project, tags, dryRun } = ctx;
  const absInput = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  if (!fs.existsSync(absInput)) {
    throw new Error(`Input not found: ${input}`);
  }

  if (fs.statSync(absInput).isFile()) {
    throw new Error('ChatGPT export must be a folder. Extract the OpenAI export ZIP first, then pass the folder path.');
  }

  const conversationsPath = findConversationsJson(absInput);
  if (!conversationsPath) {
    throw new Error('conversations.json not found in input. Export from ChatGPT: Settings → Data Controls → Export Data.');
  }

  const raw = fs.readFileSync(conversationsPath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid conversations.json: ${e.message}`);
  }

  let conversations;
  if (Array.isArray(data)) {
    conversations = data;
  } else if (data.conversations && typeof data.conversations === 'object') {
    conversations = Object.values(data.conversations);
  } else {
    conversations = [];
  }
  if (!conversations.length) {
    return { imported: [], count: 0 };
  }

  const imported = [];
  for (let i = 0; i < conversations.length; i++) {
    const conv = conversations[i];
    const title = conv.title || `Conversation ${i + 1}`;
    const mapping = conv.mapping || {};
    const body = buildTranscript(mapping);
    if (!body.trim()) continue;

    const convId = conv.id || Object.keys(mapping)[0] || `conv-${i}`;
    const sourceId = `chatgpt_${String(convId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)}`;
    const date = extractDate(conv);
    const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || `chatgpt-${i}`;
    const outputRel = path.join(outputBase, `${safeTitle}.md`).replace(/\\/g, '/');

    const frontmatter = {
      source: 'chatgpt',
      source_id: sourceId,
      date,
      title,
      ...(project && { project: normalizeSlug(project) }),
      ...(tags.length && { tags }),
    };

    if (!dryRun) {
      writeNote(vaultPath, outputRel, { body, frontmatter });
    }
    imported.push({ path: outputRel, source_id: sourceId });
  }

  return { imported, count: imported.length };
}

function findConversationsJson(dir) {
  const p = path.join(dir, 'conversations.json');
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      const found = findConversationsJson(path.join(dir, e.name));
      if (found) return found;
    }
  }
  return null;
}

/**
 * Build transcript from mapping. Order by message creation_time or parent chain.
 * @param {Record<string, { message?: { content?: { parts?: string[] }, author?: { role?: string } }, children?: string[] }>} mapping
 */
function buildTranscript(mapping) {
  const parts = [];
  const seen = new Set();
  const entries = Object.entries(mapping);

  for (const [, info] of entries) {
    const msg = info?.message;
    if (!msg) continue;
    const content = msg.content;
    const text = content?.parts?.[0];
    if (typeof text !== 'string' || !text.trim()) continue;
    const role = msg.author?.role || 'unknown';
    parts.push({ role, text, create_time: msg.create_time });
  }

  parts.sort((a, b) => (a.create_time || 0) - (b.create_time || 0));
  return parts.map((p) => `**${p.role}:**\n${p.text}`).join('\n\n');
}

function extractDate(conv) {
  const createTime = conv.create_time || conv.created;
  if (createTime) {
    const d = new Date(createTime * 1000);
    return d.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}
