/**
 * Memory layer: store query results and provenance. Phase 8.
 * File backend: data/memory.json. Graceful: skip on error.
 */

import fs from 'fs';
import path from 'path';

/**
 * Store a value under a key. File backend.
 * @param {string} dataDir - Absolute path to data dir (e.g. config.data_dir)
 * @param {string} key - e.g. 'last_search', 'last_export'
 * @param {object} value
 */
export function storeMemory(dataDir, key, value) {
  try {
    const filePath = path.join(dataDir, 'memory.json');
    let data = {};
    if (fs.existsSync(filePath)) {
      try {
        data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (_) {}
    }
    data[key] = { ...value, _at: new Date().toISOString() };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('knowtation: memory store failed:', e.message);
  }
}

/**
 * Read a value by key. Returns null on miss or error.
 * @param {string} dataDir
 * @param {string} key
 * @returns {object|null}
 */
export function getMemory(dataDir, key) {
  try {
    const filePath = path.join(dataDir, 'memory.json');
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data[key] ?? null;
  } catch (_) {
    return null;
  }
}
