// For hosted deploy: the Hub on knowtation.store must call the Netlify gateway. On localhost we use
// the same origin (your local Hub is the API), so sign-in and API calls work without this.
if (typeof window !== 'undefined' && (window.location.hostname === 'knowtation.store' || window.location.hostname === 'www.knowtation.store')) {
  window.HUB_API_BASE_URL = 'https://knowtation-gateway.netlify.app';
}
