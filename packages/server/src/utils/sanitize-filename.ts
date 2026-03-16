/**
 * Sanitize a filename for use in Content-Disposition headers.
 * Strips characters that can cause header injection (" \r \n),
 * then returns an RFC 5987-encoded header value.
 */
export function sanitizeContentDisposition(disposition: 'attachment' | 'inline', filename: string): string {
  const sanitized = filename.replace(/["\\r\\n\r\n]/g, '');
  const encoded = encodeURIComponent(sanitized);
  return `${disposition}; filename*=UTF-8''${encoded}`;
}
