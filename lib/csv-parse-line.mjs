/**
 * Parse a single CSV line respecting quoted fields (commas inside quotes).
 * @param {string} line
 * @returns {string[]}
 */
export function parseCSVLine(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      let field = '';
      while (i < line.length) {
        if (line[i] === '"') {
          i++;
          if (line[i] === '"') {
            field += '"';
            i++;
          } else break;
        } else {
          field += line[i++];
        }
      }
      out.push(field);
    } else {
      let field = '';
      while (i < line.length && line[i] !== ',') {
        field += line[i++];
      }
      out.push(field.trim());
      if (line[i] === ',') i++;
    }
  }
  return out;
}
