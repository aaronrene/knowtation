/**
 * Writes public/_redirects so traffic goes to gateway or bridge function.
 * Set USE_BRIDGE_FUNCTION=true on the knowtation-bridge site only.
 * We always write _redirects so both sites have explicit routing (avoids netlify.toml ambiguity).
 */
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = new URL('../public', import.meta.url);
const redirectsPath = new URL('_redirects', publicDir);

const useBridge = process.env.USE_BRIDGE_FUNCTION === 'true' || process.env.USE_BRIDGE_FUNCTION === '1';
console.log('[netlify-redirects] USE_BRIDGE_FUNCTION=%s → %s', process.env.USE_BRIDGE_FUNCTION ?? '(unset)', useBridge ? 'bridge' : 'gateway');

await mkdir(publicDir, { recursive: true });
const line = useBridge ? '/* /.netlify/functions/bridge 200' : '/* /.netlify/functions/gateway 200';
await writeFile(redirectsPath, line + '\n', 'utf8');
console.log('[netlify-redirects] Wrote public/_redirects: %s', line);
