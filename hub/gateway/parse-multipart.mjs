/**
 * Minimal multipart/form-data file parser for the Knowtation gateway.
 * Used to extract the first file field from a buffered multipart body without
 * forwarding the binary to another Lambda function (which causes serialization issues).
 */

/**
 * Parse the first file field from a raw multipart/form-data buffer.
 * @param {Buffer} body - full raw multipart body
 * @param {string} boundary - boundary string from Content-Type header (without leading --)
 * @returns {{ filename: string, contentType: string, data: Buffer } | null}
 */
export function parseMultipartFile(body, boundary) {
  const enc = 'binary';
  const bodyStr = body.toString(enc);
  const boundaryLine = '--' + boundary;
  const parts = bodyStr.split(boundaryLine);
  for (const part of parts) {
    if (!part || part.startsWith('--')) continue;
    const crlfDoubleCrlf = '\r\n\r\n';
    const headerEnd = part.indexOf(crlfDoubleCrlf);
    if (headerEnd === -1) continue;
    const headerSection = part.slice(0, headerEnd);
    if (!headerSection.toLowerCase().includes('content-disposition')) continue;
    // Only process parts that have a filename (file fields, not text fields).
    const filenameMatch = headerSection.match(/filename="([^"]+)"/i);
    if (!filenameMatch) continue;
    const ctMatch = headerSection.match(/content-type:\s*([^\r\n]+)/i);
    const contentType = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';
    // File data starts after the double CRLF; strip trailing \r\n added by multipart framing.
    const dataStart = headerEnd + crlfDoubleCrlf.length;
    let dataStr = part.slice(dataStart);
    if (dataStr.endsWith('\r\n')) dataStr = dataStr.slice(0, -2);
    return {
      filename: filenameMatch[1],
      contentType,
      data: Buffer.from(dataStr, enc),
    };
  }
  return null;
}
