/**
 * Repo root for path resolution. On Netlify/AWS Lambda, bundled code may have a broken
 * import.meta.url; cwd is the function bundle root and matches hub/bridge serverless handling.
 */
import path from 'path';
import { fileURLToPath } from 'url';

export function getRepoRoot() {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY) {
    return process.cwd();
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..');
}
