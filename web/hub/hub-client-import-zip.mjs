/**
 * Hub import: in-browser ZIP for folder-shaped sources (Phase 4A₂).
 * Shared by `hub-import-zip-shim.mjs` (browser) and unit tests (Node + jszip).
 */

/** @typedef {{ maxZipBytes: number, maxUncompressedBytes: number, maxFiles: number }} HubImportZipLimits */

/** Default caps (align with `hub/server.mjs` + bridge multer: 100MB upload). */
export const DEFAULT_HUB_IMPORT_ZIP_LIMITS = Object.freeze({
  maxZipBytes: 100 * 1024 * 1024,
  maxUncompressedBytes: 100 * 1024 * 1024,
  maxFiles: 5000,
});

/**
 * One POST per file (Phase 4B) for source types that use a single file / CSV row file at a time.
 * Jira/Wallet: directory input uses the first .csv (see importers) — for multiple CSVs, use sequential.
 */
export const HUB_IMPORT_SEQUENTIAL_MULTI_SOURCE_TYPES = new Set([
  'pdf',
  'docx',
  'mem0-export',
  'linear-export',
  'audio',
  'jira-export',
  'wallet-csv',
  'supabase-memory',
  'generic-csv',
  'json-rows',
]);

/**
 * Types where a **directory** after server ZIP extraction is a valid `runImport` input and
 * multiple local files are merged into one client-built ZIP (markdown trees, mif, exports, etc.).
 * ChatGPT/Claude have extra rules in `getHubImportFileMode`.
 */
export const HUB_IMPORT_ZIP_BULK_SOURCE_TYPES = new Set([
  'markdown',
  'mif',
  'gdrive',
  'notebooklm',
  'claude-export',
  'chatgpt-export',
]);

/**
 * @param {string} sourceType
 * @param {File[]} files
 * @returns {'direct' | 'client_zip' | 'sequential'} `direct` = one POST; `client_zip` = 4A₂; `sequential` = 4B.
 */
export function getHubImportFileMode(sourceType, files) {
  const list = Array.isArray(files) ? files : Array.from(files);
  const n = list.length;
  if (n === 0) return 'direct';

  if (sourceType === 'url') return 'direct';

  if (n === 1 && list[0] && list[0].name && list[0].name.toLowerCase().endsWith('.zip')) {
    return 'direct';
  }

  if (HUB_IMPORT_SEQUENTIAL_MULTI_SOURCE_TYPES.has(sourceType) && n > 1) {
    return 'sequential';
  }

  if (sourceType === 'chatgpt-export') {
    if (n === 1 && list[0].name && list[0].name.toLowerCase().endsWith('.zip')) return 'direct';
    return 'client_zip';
  }

  if (sourceType === 'claude-export' && n > 1) {
    const allMd = list.every((f) => f.name && /\.(md|markdown)$/i.test(f.name));
    return allMd ? 'client_zip' : 'sequential';
  }

  if (HUB_IMPORT_ZIP_BULK_SOURCE_TYPES.has(sourceType) && n > 1) {
    return 'client_zip';
  }

  return 'direct';
}

/**
 * @param {string} rel
 * @returns {boolean}
 */
function isSafeRelativeZipPath(rel) {
  if (!rel || rel.includes('..') || rel.startsWith('/') || rel.startsWith('\\')) return false;
  return true;
}

/**
 * @param {File} f
 * @returns {string}
 */
function defaultRelativePathForFile(f) {
  const w = typeof f.webkitRelativePath === 'string' && f.webkitRelativePath ? f.webkitRelativePath : f.name;
  return w.split('\\').join('/');
}

/**
 * @param {File[]} files
 * @param {{ warn?: (s: string) => void }} [opt]
 * @returns {string[]}
 */
function dedupePaths(names, opt) {
  const seen = new Set();
  const out = [];
  for (const raw of names) {
    const base = raw.split('\\').join('/');
    if (!isSafeRelativeZipPath(base)) {
      throw new Error('Unsafe path in selection: ' + raw);
    }
    let name = base;
    let n = 0;
    while (seen.has(name)) {
      n++;
      const dot = base.lastIndexOf('.');
      if (dot > 0) {
        name = `${base.slice(0, dot)}(${n})${base.slice(dot)}`;
      } else {
        name = `${base}(${n})`;
      }
      if (opt && typeof opt.warn === 'function' && n === 1) {
        opt.warn(`Renamed duplicate path: ${base} → ${name}`);
      }
    }
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * @param {HubImportZipLimits} limits
 * @param {number} uncompressedDelta
 * @param {number} fileCount
 */
function enforceRunningLimits(limits, uncompressedDelta, fileCount) {
  if (fileCount > limits.maxFiles) {
    throw new Error(
      `Too many files (${fileCount}). Max ${limits.maxFiles} in one ZIP. Split the batch or use the CLI.`,
    );
  }
  if (uncompressedDelta > limits.maxUncompressedBytes) {
    throw new Error(
      `Uncompressed total exceeds limit (${limits.maxUncompressedBytes} bytes). Choose fewer or smaller files.`,
    );
  }
}

/**
 * @param {import('jszip').default} JSZipCtor
 * @param {File[]} fileList
 * @param {HubImportZipLimits} limits
 * @param {{ signal?: AbortSignal, warn?: (s: string) => void, pathForFile?: (f: File) => string }} [opts]
 * @returns {Promise<Blob>}
 */
export async function buildImportZipBlobWithJsZip(JSZipCtor, fileList, limits, opts = {}) {
  const { signal, warn, pathForFile } = opts;
  const list = Array.isArray(fileList) ? fileList : Array.from(fileList);
  if (list.length === 0) {
    throw new Error('No files to zip.');
  }

  const nameFn = pathForFile || defaultRelativePathForFile;
  const names = list.map((f) => nameFn(f));
  const paths = dedupePaths(names, { warn });

  const zip = new JSZipCtor();
  let uncompressed = 0;
  for (let i = 0; i < list.length; i++) {
    if (signal && signal.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
    const f = list[i];
    const p = paths[i];
    if (!f.size && p.endsWith('/')) {
      continue;
    }
    uncompressed += f.size || 0;
    enforceRunningLimits(limits, uncompressed, i + 1);
    const buf = await f.arrayBuffer();
    if (uncompressed > limits.maxUncompressedBytes) {
      throw new Error('Uncompressed total exceeds limit after reading files.');
    }
    zip.file(p, buf);
  }

  enforceRunningLimits(limits, uncompressed, list.length);
  if (typeof zip.generateAsync !== 'function') {
    throw new Error('Invalid JSZip instance; generateAsync missing');
  }
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    streamFiles: true,
  });
  if (blob && blob.size > limits.maxZipBytes) {
    throw new Error(
      `ZIP is ${blob.size} bytes; max ${limits.maxZipBytes} (matches server upload limit).`,
    );
  }
  return blob;
}

/**
 * 4B: server accepts one file at a time, max size per `DEFAULT_HUB_IMPORT_ZIP_LIMITS.maxZipBytes`.
 * @param {File} f
 * @param {HubImportZipLimits} limits
 */
export function assertSingleFileWithinLimit(f, limits) {
  if (f && f.size > limits.maxZipBytes) {
    throw new Error(
      `File is ${f.size} bytes; max per upload is ${limits.maxZipBytes} bytes (~100MB).`,
    );
  }
}

export { isSafeRelativeZipPath, defaultRelativePathForFile };
