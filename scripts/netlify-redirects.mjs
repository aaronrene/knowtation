/**
 * Writes public/_redirects so traffic goes to gateway or bridge function.
 * Set USE_BRIDGE_FUNCTION=true on the knowtation-bridge site only.
 * We always write _redirects so both sites have explicit routing (avoids netlify.toml ambiguity).
 */
import { mkdir, writeFile, readFile } from 'fs/promises';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = new URL('../public', import.meta.url);
const redirectsPath = new URL('_redirects', publicDir);

const useBridge = process.env.USE_BRIDGE_FUNCTION === 'true' || process.env.USE_BRIDGE_FUNCTION === '1';
console.log('[netlify-redirects] USE_BRIDGE_FUNCTION=%s → %s', process.env.USE_BRIDGE_FUNCTION ?? '(unset)', useBridge ? 'bridge' : 'gateway');

await mkdir(publicDir, { recursive: true });
// Both sites must use :splat so the function URL includes the visitor path (e.g. /api/v1/notes).
// Without :splat, every request hits the function as "/" and the canister returns 404 Not found.
const line = useBridge
  ? '/* /.netlify/functions/bridge/:splat 200'
  : '/* /.netlify/functions/gateway/:splat 200';
await writeFile(redirectsPath, line + '\n', 'utf8');
const content = await readFile(redirectsPath, 'utf8');
if (!content.includes(line.trim())) {
  console.error('[netlify-redirects] Build assertion failed: public/_redirects does not contain expected line:', line.trim());
  process.exit(1);
}
console.log('[netlify-redirects] Wrote public/_redirects: %s', line);
