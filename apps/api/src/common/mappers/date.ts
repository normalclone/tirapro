/** Date → chuỗi ISO 8601; null/undefined giữ nguyên là `null` để khớp contract REST. */
export function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}
