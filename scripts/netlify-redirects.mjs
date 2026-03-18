/**
 * Writes public/_redirects for the bridge Netlify site so traffic goes to the bridge function.
 * Run during build. Set USE_BRIDGE_FUNCTION=true on the knowtation-bridge site only.
 * Netlify processes _redirects before netlify.toml, so this overrides the default gateway redirect.
 */
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = new URL('../public', import.meta.url);
const redirectsPath = new URL('_redirects', publicDir);

if (process.env.USE_BRIDGE_FUNCTION === 'true' || process.env.USE_BRIDGE_FUNCTION === '1') {
  await mkdir(publicDir, { recursive: true });
  await writeFile(redirectsPath, '/* /.netlify/functions/bridge 200\n', 'utf8');
  console.log('Wrote public/_redirects for bridge function');
} else {
  // Gateway site: leave netlify.toml redirect in effect (no _redirects file)
  console.log('USE_BRIDGE_FUNCTION not set; netlify.toml redirect will apply (gateway)');
}
