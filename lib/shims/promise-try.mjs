/**
 * PDF.js (via unpdf) uses Promise.try (ES2024). Node 20 does not implement it; bridge/CI use Node 20.
 * The standard signature is `Promise.try(fn, ...args)` and invokes `fn` with `args` (e.g. worker
 * `Promise.try(handler, e.data)`). A no-arg `fn => resolve(fn())` polyfill breaks PDF import in CI.
 * @see https://github.com/tc39/proposal-promise-try
 */
if (typeof Promise.try !== 'function') {
  Promise.try = (fn, ...args) => {
    try {
      return Promise.resolve(fn.call(undefined, ...args));
    } catch (e) {
      return Promise.reject(e);
    }
  };
}
