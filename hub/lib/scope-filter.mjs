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

/**
 * Filter proposals the same way as notes for hosted team scope (folder prefix + project slug).
 * Full proposal objects from GET /proposals/:id include `path`; `project` may appear in frontmatter.
 *
 * @param {Array<{ path?: string, project?: string | null, frontmatter?: string | object }>} proposals
 * @param {{ projects?: string[], folders?: string[] } | null | undefined} scope
 * @returns {typeof proposals}
 */
export function applyScopeFilterToProposals(proposals, scope) {
  if (!scope || (!scope.projects?.length && !scope.folders?.length)) return proposals;
  const list = Array.isArray(proposals) ? proposals : [];
  return list.filter((p) => {
    const pathStr = p.path && typeof p.path === 'string' ? p.path : '';
    if (scope.folders?.length) {
      const folder = pathStr.includes('/') ? pathStr.split('/').slice(0, -1).join('/') : '';
      if (scope.folders.some((f) => folder === f || folder.startsWith(f + '/'))) return true;
    }
    if (scope.projects?.length) {
      let proj = p.project && typeof p.project === 'string' ? p.project : null;
      if (!proj && pathStr.startsWith('projects/')) {
        const rest = pathStr.slice('projects/'.length);
        proj = rest.split('/')[0] || null;
      }
      if (!proj && p.frontmatter) {
        let fm = p.frontmatter;
        if (typeof fm === 'string' && fm.trim()) {
          try {
            fm = JSON.parse(fm);
          } catch {
            fm = null;
          }
        }
        if (fm && typeof fm === 'object' && !Array.isArray(fm) && fm.project) {
          proj = String(fm.project);
        }
      }
      if (proj && scope.projects.includes(proj)) return true;
    }
    return false;
  });
}
