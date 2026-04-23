/**
 * vCard (.vcf) — one Markdown note per BEGIN:VCARD block under contacts/…/vcf/
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { writeNote } from '../write.mjs';
import { normalizeSlug } from '../vault.mjs';

const MAX_VCF_BYTES = 20 * 1024 * 1024;
const MAX_CARDS = 20_000;

/**
 * @param {string} raw
 * @returns {string[]}
 */
function unfoldVcfLines(raw) {
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (line.length > 0 && (line[0] === ' ' || line[0] === '\t')) {
      if (out.length) out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/**
 * @param {string} block
 * @returns {Record<string, string>}
 */
function vcardKeyValues(block) {
  /** @type {Record<string, string>} */
  const m = {};
  for (const line of block.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const idx = t.indexOf(':');
    if (idx < 0) continue;
    const keyPart = t.slice(0, idx);
    const val = t.slice(idx + 1);
    const key = keyPart.split(/[;:]/)[0].toUpperCase();
    if (!key) continue;
    m[key] = m[key] ? m[key] + '\n' + val : val;
  }
  return m;
}

/**
 * @param {string} input
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean }} ctx
 */
export async function importVcf(input, ctx) {
  const { vaultPath, outputBase, project, tags, dryRun } = ctx;
  const absInput = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  if (!fs.existsSync(absInput) || !fs.statSync(absInput).isFile()) {
    throw new Error('vcf import expects a path to a .vcf file.');
  }
  const low = absInput.toLowerCase();
  if (!low.endsWith('.vcf') && !low.endsWith('.vcard')) {
    throw new Error('vcf import requires a .vcf or .vcard file.');
  }
  if (fs.statSync(absInput).size > MAX_VCF_BYTES) {
    throw new Error(`VCF file too large (max ${MAX_VCF_BYTES} bytes).`);
  }

  let raw = fs.readFileSync(absInput, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  }
  const text = unfoldVcfLines(raw).join('\n');
  const re = /BEGIN:VCARD\b([\s\S]*?)END:VCARD/gi;
  const blocks = [];
  let mm;
  while ((mm = re.exec(text)) !== null) {
    blocks.push(mm[1].trim());
  }
  if (blocks.length === 0) {
    throw new Error('No vCard blocks (BEGIN:VCARD … END:VCARD) found in this file.');
  }
  if (blocks.length > MAX_CARDS) {
    throw new Error(`Too many vCards in one file (max ${MAX_CARDS}).`);
  }

  const baseName = path.basename(absInput);
  const outDir = path.join(outputBase, 'contacts', 'vcf').replace(/\\/g, '/');
  const now = new Date().toISOString().slice(0, 10);
  const imported = [];

  for (let i = 0; i < blocks.length; i++) {
    const f = vcardKeyValues(blocks[i]);
    const fnRaw = (f.FN || f['X-ABSHOWAS'] || '').split('\n')[0].trim() || 'Contact';
    const fn = fnRaw.length > 200 ? fnRaw.slice(0, 200) : fnRaw;
    const uid = (f.UID || '').split('\n')[0].trim();
    const sourceId = uid
      ? uid.slice(0, 200)
      : crypto
          .createHash('sha256')
          .update(blocks[i] + baseName + String(i))
          .digest('hex')
          .slice(0, 32);

    const fileSlug = crypto
      .createHash('sha256')
      .update(blocks[i] + String(i))
      .digest('hex')
      .slice(0, 8);
    const safe = normalizeSlug(fn.replace(/[<>:"/\\|?*]+/g, ' ')) || 'contact';
    const nameFile = `${safe}`.slice(0, 60) + `-${fileSlug}.md`;
    const outputRel = path.join(outDir, nameFile).replace(/\\/g, '/');

    const lines = ['# ' + fn, ''];
    const add = (label, key) => {
      const v = f[key];
      if (v && String(v).trim()) lines.push(`- **${label}:** ${String(v).split('\n').join(' · ')}`);
    };
    add('Name', 'N');
    add('Full name', 'FN');
    add('Organization', 'ORG');
    add('Title', 'TITLE');
    add('Phone', 'TEL');
    add('Email', 'EMAIL');
    add('URL', 'URL');
    add('Address', 'ADR');
    add('Note', 'NOTE');
    lines.push('', '## Raw vCard', '', '```', blocks[i], '```');

    const body = lines.join('\n');
    const frontmatter = {
      source: 'vcf-import',
      source_id: sourceId,
      date: now,
      vcf_file: baseName,
      vcf_index: i,
      title: fn,
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
