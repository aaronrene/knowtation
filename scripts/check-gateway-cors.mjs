#!/usr/bin/env node
/**
 * OPTIONS preflight probe against the hosted gateway (no JWT).
 * Confirms Access-Control-Allow-Origin is not * together with Allow-Credentials: true.
 *
 *   KNOWTATION_HUB_API=https://knowtation-gateway.netlify.app node scripts/check-gateway-cors.mjs
 */

const apiBase = (process.env.KNOWTATION_HUB_API || 'https://knowtation-gateway.netlify.app').replace(/\/$/, '');
const origins = (process.env.KNOWTATION_CORS_TEST_ORIGINS ||
  'https://knowtation.store,https://www.knowtation.store')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function probe(origin) {
  const url = `${apiBase}/api/v1/health`;
  const res = await fetch(url, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
    },
  });
  const ao = res.headers.get('access-control-allow-origin');
  const ac = res.headers.get('access-control-allow-credentials');
  return { status: res.status, allowOrigin: ao, allowCredentials: ac };
}

async function main() {
  console.log('Gateway:', apiBase);
  for (const origin of origins) {
    try {
      const r = await probe(origin);
      const bad = r.allowOrigin === '*' && r.allowCredentials === 'true';
      console.log(
        origin,
        '→',
        r.status,
        'Allow-Origin:',
        r.allowOrigin || '(missing)',
        'Allow-Credentials:',
        r.allowCredentials || '(missing)',
        bad ? '❌ INVALID (* + credentials)' : 'ok',
      );
    } catch (e) {
      console.log(origin, '→ ERROR', e.message);
    }
  }
  console.log('\nProduction: set Netlify HUB_CORS_ORIGIN to both apex and www (see hub/gateway/cors-middleware.mjs).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
