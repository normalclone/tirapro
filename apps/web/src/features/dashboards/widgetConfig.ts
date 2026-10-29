/** Đọc khoá chuỗi/số của `config` (kiểu `Record<string, unknown>` từ máy chủ) một cách an toàn. */
export function cfgString(config: Record<string, unknown>, key: string): string | undefined {
  const v = config[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

export function cfgNumber(config: Record<string, unknown>, key: string, fallback: number): number {
  const v = config[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
