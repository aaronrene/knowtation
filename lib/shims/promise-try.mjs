/**
 * PDF.js (via unpdf) uses Promise.try (ES2024). Node 20 does not implement it; bridge/CI use Node 20.
 * @see https://github.com/tc39/proposal-promise-try
 */
if (typeof Promise.try !== 'function') {
  Promise.try = (fn) => {
    try {
      return Promise.resolve(fn());
    } catch (e) {
      return Promise.reject(e);
    }
  };
}
