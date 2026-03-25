/**
 * Filter note list/search results by per-user scope (projects + folders).
 * Same behavior as applyScopeFilter in hub/server.mjs; used by gateway (hosted) and Node Hub.
 *
 * Each note: { path, project?, ... }
 */

/**
 * @param {Array<{ path?: string, project?: string | null }>} notes
 * @param {{ projects?: string[], folders?: string[] } | null | undefined} scope
 * @returns {Array<{ path?: string, project?: string | null }>}
 */
export function applyScopeFilterToNotes(notes, scope) {
  if (!scope || (!scope.projects?.length && !scope.folders?.length)) return notes;
  const list = Array.isArray(notes) ? notes : [];
  return list.filter((n) => {
    if (scope.folders?.length) {
      const p = n.path && typeof n.path === 'string' ? n.path : '';
      const folder = p.includes('/') ? p.split('/').slice(0, -1).join('/') : '';
      if (scope.folders.some((f) => folder === f || folder.startsWith(f + '/'))) return true;
    }
    if (scope.projects?.length && n.project && scope.projects.includes(n.project)) return true;
    return false;
  });
}
