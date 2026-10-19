const trim = (s: string) => s.replace(/^\/+|\/+$/g, '');

/** Đường probe sức khoẻ (khớp CHÍNH XÁC theo pathname), dựng từ cùng prefix/version mà `main.ts` dùng cho setGlobalPrefix. */
export function buildHealthPaths(globalPrefix: string, version: string): Set<string> {
  const base = '/' + [trim(globalPrefix), trim(version), 'health'].filter(Boolean).join('/');
  return new Set([base, `${base}/live`, `${base}/ready`]);
}

export function isHealthPath(url: string | undefined, paths: ReadonlySet<string>): boolean {
  return paths.has((url ?? '').split('?')[0] ?? '');
}
