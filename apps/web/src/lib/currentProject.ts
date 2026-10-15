/** localStorage: view cơ bản người dùng mở gần nhất (để /projects mở lại đúng view). */
export const LAST_VIEW_KEY = 'tirapro:lastProjectView';

/** decodeURIComponent không ném lỗi với đường dẫn hỏng (vd `%E0%A4%A`) — lỗi thì dùng nguyên chuỗi. */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Dự án "hiện tại": `/p/:key` → view mở gần nhất (nếu dự án còn tồn tại) → dự án đầu. Thuần để test. */
export function resolveCurrentProjectKey(input: {
  pathname: string;
  projects: { key: string }[] | undefined;
  lastViewRaw: string | null;
}): string | null {
  const m = /^\/p\/([^/]+)/.exec(input.pathname);
  if (m) return safeDecode(m[1]!);
  try {
    const saved = JSON.parse(input.lastViewRaw || '{}') as { key?: string };
    if (saved.key && (input.projects ?? []).some((p) => p.key === saved.key)) return saved.key;
  } catch {
    /* JSON hỏng → bỏ qua */
  }
  return input.projects?.[0]?.key ?? null;
}

/** Dự án hiện tại cho các hành động điều hướng (Cmd+K, phím tắt `c`, `g b`, `g l`…). */
export function currentProjectKey(projects: { key: string }[] | undefined): string | null {
  let lastViewRaw: string | null = null;
  try {
    lastViewRaw = localStorage.getItem(LAST_VIEW_KEY);
  } catch {
    /* storage bị chặn */
  }
  return resolveCurrentProjectKey({ pathname: window.location.pathname, projects, lastViewRaw });
}
