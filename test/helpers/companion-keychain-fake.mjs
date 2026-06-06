/**
 * Test-only in-memory keychain adapter for the Phase 3 token-custody module.
 *
 * NOT a test file (lives under test/helpers/, outside the `test/*.test.mjs` glob). It exists so
 * the custody tests can inject a deterministic, volatile `{ get, set, delete }` adapter in place
 * of a real OS keychain. This is exactly the seam the custody module relies on: the module never
 * performs real keychain I/O — it delegates to whatever adapter is injected (this fake in tests;
 * macOS Keychain / Windows DPAPI / Linux libsecret in Phase 5).
 *
 * Two flavors are provided to prove the custody code drives a synchronous OR a Promise-returning
 * adapter identically (the module awaits every call).
 */

/**
 * A synchronous in-memory keychain.
 * @returns {{ get: Function, set: Function, delete: Function, _store: Map<string,string>, writes: Array<{account:string,secret:string}> }}
 */
export function makeSyncKeychain() {
  const store = new Map();
  const writes = [];
  return {
    _store: store,
    writes,
    get(account) {
      return store.has(account) ? store.get(account) : null;
    },
    set(account, secret) {
      writes.push({ account, secret });
      store.set(account, secret);
    },
    delete(account) {
      store.delete(account);
    },
  };
}

/**
 * An async (Promise-returning) in-memory keychain — mirrors a real backend that returns Promises.
 * @returns {{ get: Function, set: Function, delete: Function, _store: Map<string,string> }}
 */
export function makeAsyncKeychain() {
  const store = new Map();
  return {
    _store: store,
    async get(account) {
      return store.has(account) ? store.get(account) : null;
    },
    async set(account, secret) {
      store.set(account, secret);
    },
    async delete(account) {
      store.delete(account);
    },
  };
}
