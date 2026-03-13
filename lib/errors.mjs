/**
 * CLI error handling: exit 1 (usage) / 2 (runtime), optional JSON error object. SPEC §4.2, §4.3.
 */

/**
 * Print error and exit. With useJson, writes { "error": message, "code": code } to stderr and exits.
 * @param {string} message
 * @param {1|2} code - 1 = usage, 2 = runtime
 * @param {boolean} useJson - If true, output JSON error object to stderr
 */
export function exitWithError(message, code = 1, useJson = false) {
  if (useJson) {
    const err = { error: message, code: code === 1 ? 'USAGE_ERROR' : 'RUNTIME_ERROR' };
    process.stderr.write(JSON.stringify(err) + '\n');
  } else {
    console.error(message);
  }
  process.exit(code);
}
