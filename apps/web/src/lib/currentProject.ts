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

export interface CreateTarget {
  projectKey?: string;
  /** Câu báo người dùng (toast) khi phải đổi dự án đích. */
  notice?: string;
  /** true = không có dự án nào tạo việc được → chỉ báo, không mở dialog. */
  block?: boolean;
}

/**
 * Dự án đích của "Tạo việc" từ phím `c` / Cmd+K / nút nổi. Dự án hiện tại (lấy từ URL) mà không nằm trong danh sách
 * dự án ĐANG HOẠT ĐỘNG là dự án đã lưu trữ (hoặc không còn) → dùng dự án đầu tiên đang hoạt động, hoặc chặn.
 * Danh sách chưa tải → giữ key hiện tại như cũ.
 */
export function resolveCreateTarget(
  currentKey: string | null,
  active: { key: string }[] | undefined,
): CreateTarget {
  if (!currentKey || !active || active.some((p) => p.key === currentKey))
    return { projectKey: currentKey ?? undefined };
  const fallback = active[0];
  if (!fallback)
    return {
      block: true,
      notice: `Dự án “${currentKey}” đã lưu trữ — hãy khôi phục dự án hoặc tạo một dự án khác trước khi thêm việc.`,
    };
  return {
    projectKey: fallback.key,
    notice: `Dự án “${currentKey}” đã lưu trữ nên không thêm việc được — đã chọn dự án “${fallback.key}”.`,
  };
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
