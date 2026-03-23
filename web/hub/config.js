// For hosted deploy: default is cross-origin Netlify gateway (requires correct HUB_CORS_ORIGIN on Netlify).
// If your static host reverse-proxies /api/* to that gateway, use same origin to avoid CORS entirely:
//   window.HUB_API_BASE_URL = '';
// (empty string → hub.js uses location.origin)
if (typeof window !== 'undefined' && (window.location.hostname === 'knowtation.store' || window.location.hostname === 'www.knowtation.store')) {
  window.HUB_API_BASE_URL = 'https://knowtation-gateway.netlify.app';
}
