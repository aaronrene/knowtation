/**
 * Scheduled function: pings the gateway Lambda every 5 minutes to prevent cold starts.
 * Cold-starting the 1.8 MB gateway bundle takes 12+ seconds on Netlify, which exceeds
 * browser TLS-handshake timeouts and causes ERR_CONNECTION_CLOSED / ERR_TIMED_OUT.
 * This keeps the Lambda warm so real user requests always hit a hot instance.
 */
export default async () => {
  const siteUrl = process.env.URL || 'https://knowtation-gateway.netlify.app';
  try {
    const res = await fetch(`${siteUrl}/api/v1/auth/providers`, {
      signal: AbortSignal.timeout(20000),
    });
    console.log('[warmup] gateway responded:', res.status);
  } catch (e) {
    console.log('[warmup] gateway ping failed (expected on first cold start):', e?.message || String(e));
  }
  return new Response('ok');
};

export const config = {
  schedule: '@every 5m',
};
