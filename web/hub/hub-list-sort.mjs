/**
 * Pure list sort helpers for Hub notes and proposals (used by hub.js + tests).
 */

export function noteTimestampForSort(n) {
  if (!n || typeof n !== 'object') return 0;
  const tryParse = (s) => {
    if (s == null || s === '') return 0;
    const t = Date.parse(String(s));
    return Number.isNaN(t) ? 0 : t;
  };
  const t1 = tryParse(n.updated);
  if (t1) return t1;
  const t2 = tryParse(n.date);
  return t2 || 0;
}

/** @param {string} dayKey - e.g. YYYY-MM-DD from calendar display */
export function yearFromDayKey(dayKey) {
  if (!dayKey || typeof dayKey !== 'string') return 0;
  const m = dayKey.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * @param {(a: object, b: object) => number} noteSortOrCalendarDayCmp - (a,b) => string compare of day keys
 */
export function sortNotesList(notes, mode, noteSortOrCalendarDay) {
  const out = Array.isArray(notes) ? notes.slice() : [];
  const dayKey = (n) => (typeof noteSortOrCalendarDay === 'function' ? noteSortOrCalendarDay(n) : '') || '';
  const cmpPath = (a, b) => String(a.path || '').localeCompare(String(b.path || ''));
  const cmpTitle = (a, b) =>
    String(a.title || a.path || '').localeCompare(String(b.title || b.path || ''));
  switch (mode) {
    case 'date_asc':
      return out.sort(
        (a, b) => noteTimestampForSort(a) - noteTimestampForSort(b) || cmpPath(a, b),
      );
    case 'year_desc':
      return out.sort((a, b) => {
        const yd = yearFromDayKey(dayKey(b)) - yearFromDayKey(dayKey(a));
        if (yd !== 0) return yd;
        return noteTimestampForSort(b) - noteTimestampForSort(a) || cmpPath(a, b);
      });
    case 'year_asc':
      return out.sort((a, b) => {
        const ya = yearFromDayKey(dayKey(a)) - yearFromDayKey(dayKey(b));
        if (ya !== 0) return ya;
        return noteTimestampForSort(a) - noteTimestampForSort(b) || cmpPath(a, b);
      });
    case 'path_asc':
      return out.sort(cmpPath);
    case 'title_asc':
      return out.sort(cmpTitle);
    case 'date_desc':
    default:
      return out.sort(
        (a, b) => noteTimestampForSort(b) - noteTimestampForSort(a) || cmpPath(a, b),
      );
  }
}

export function proposalTimestamp(p) {
  if (!p || typeof p !== 'object') return 0;
  const t = Date.parse(String(p.updated_at || p.created_at || ''));
  return Number.isNaN(t) ? 0 : t;
}

export function sortProposalsList(list, mode) {
  const out = Array.isArray(list) ? list.slice() : [];
  const cmpPath = (a, b) => String(a.path || '').localeCompare(String(b.path || ''));
  const cmpStatus = (a, b) => String(a.status || '').localeCompare(String(b.status || ''));
  switch (mode) {
    case 'updated_asc':
      return out.sort(
        (a, b) => proposalTimestamp(a) - proposalTimestamp(b) || cmpPath(a, b),
      );
    case 'path_asc':
      return out.sort(cmpPath);
    case 'status_asc':
      return out.sort((a, b) => cmpStatus(a, b) || proposalTimestamp(b) - proposalTimestamp(a));
    case 'updated_desc':
    default:
      return out.sort(
        (a, b) => proposalTimestamp(b) - proposalTimestamp(a) || cmpPath(a, b),
      );
  }
}
