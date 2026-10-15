/** localStorage: view cơ bản người dùng mở gần nhất (để /projects mở lại đúng view). */
export const LAST_VIEW_KEY = 'tirapro:lastProjectView';
/** localStorage: key dự án ĐANG HOẠT ĐỘNG xem gần nhất (không bị dự án lưu trữ ghi đè, khác `LAST_VIEW_KEY`). */
export const LAST_ACTIVE_KEY = 'tirapro:lastActiveProject';
/** localStorage: dự án tạo việc gần nhất (do `CreateIssueModal` ghi). */
export const CREATE_LAST_KEY = 'tirapro:createIssue:last';

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
  /**
   * true = dự án hiện tại đã lưu trữ và không có dự án hoạt động nào dùng gần đây để thay → mở form với ô Dự án TRỐNG
   * (focus + gợi ý inline `ARCHIVED_PICK_HINT`), không đoán một dự án (vd đầu danh sách) rồi để người dùng tạo nhầm.
   */
  pickProject?: boolean;
}

/** Gợi ý inline ở ô Dự án khi dự án hiện tại đã lưu trữ và chưa có dự án thay thế hợp lý. */
export const ARCHIVED_PICK_HINT = 'Dự án hiện tại đã lưu trữ — chọn dự án khác';

/**
 * Dự án đích của "Tạo việc" từ phím `c` / Cmd+K / nút nổi. Dự án hiện tại (lấy từ URL) mà không nằm trong danh sách
 * dự án ĐANG HOẠT ĐỘNG (so key không phân biệt hoa/thường) là dự án đã lưu trữ hoặc không còn → dùng dự án hoạt động
 * dùng GẦN NHẤT (`recentKeys`, mới nhất trước); không có thì để người dùng tự chọn (`pickProject`) — KHÔNG lấy dự án đầu
 * danh sách. Không còn dự án hoạt động nào → chặn. Danh sách chưa tải → giữ key hiện tại như cũ.
 */
export function resolveCreateTarget(
  currentKey: string | null,
  active: { key: string }[] | undefined,
  recentKeys:
    | readonly (string | null | undefined)[]
    | (() => readonly (string | null | undefined)[]) = [],
): CreateTarget {
  // URL có thể gõ khác hoa/thường (`/p/demo`) trong khi API/danh sách dùng key in hoa.
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (!currentKey || !active) return { projectKey: currentKey ?? undefined };
  const found = active.find((p) => same(p.key, currentKey));
  if (found) return { projectKey: found.key };
  // Không có trong danh sách đang hoạt động: có thể đã lưu trữ, cũng có thể không tồn tại — không khẳng định.
  if (active.length === 0)
    return {
      block: true,
      notice: `Dự án “${currentKey}” không còn hoạt động — hãy khôi phục dự án hoặc tạo một dự án khác trước khi thêm việc.`,
    };
  // `recentKeys` có thể là hàm: chỉ đọc localStorage khi THỰC SỰ vào nhánh dự án lưu trữ (không mỗi lần vẽ).
  for (const k of typeof recentKeys === 'function' ? recentKeys() : recentKeys) {
    const recent = k ? active.find((p) => same(p.key, k)) : undefined;
    if (recent)
      return {
        projectKey: recent.key,
        notice: `Dự án “${currentKey}” không còn hoạt động nên không thêm việc được — đã chọn dự án “${recent.key}” (bạn dùng gần đây).`,
      };
  }
  return { pickProject: true };
}

/** Trang chi tiết issue `/issue/:key` → key (đã giải mã) để suy ra dự án của issue đang xem. */
export function issueKeyFromPathname(pathname: string): string | null {
  const m = /^\/issue\/([^/]+)/.exec(pathname);
  return m ? safeDecode(m[1]!) : null;
}

/**
 * Một nơi quyết định cho MỌI lối tạo việc (nút, phím `c`, Cmd+K, nút nổi, "Tạo bằng AI"):
 *  - `deny`: biết chắc không có `issue:create` ở dự án đích → ẩn nút / phím báo ngắn, KHÔNG mở form;
 *  - `blocked`: không có dự án hoạt động nào nhận việc (đã có `notice` giải thích);
 *  - `open`: mở form tạo việc vào `target.projectKey` (kèm `notice` nếu phải đổi dự án).
 * `canCreate` undefined = chưa biết (quyền đang tải) → không chặn, API vẫn kiểm.
 */
export function createAccess(
  target: CreateTarget,
  canCreate: boolean | undefined,
): 'open' | 'blocked' | 'deny' {
  if (target.block) return 'blocked';
  if (canCreate === false) return 'deny';
  return 'open';
}

export const CREATE_DENIED_NOTICE = 'Bạn không có quyền tạo việc trong dự án này.';

/** Preset mở form tạo việc từ một đích đã quyết (`pickProject` → ô Dự án trống + gợi ý). */
export function createPresetFromTarget(t: CreateTarget): {
  projectKey?: string;
  pickProject?: boolean;
} {
  return t.pickProject ? { pickProject: true } : { projectKey: t.projectKey };
}

/** Các dự án người dùng dùng gần đây (mới nhất trước) — đọc từ localStorage, lỗi/hỏng thì bỏ qua. */
export function readRecentProjectKeys(): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === 'string' && v && !out.includes(v)) out.push(v);
  };
  const addJson = (raw: string | null, field: 'key' | 'projectKey') => {
    try {
      add((JSON.parse(raw || '{}') as Record<string, unknown>)[field]);
    } catch {
      /* JSON hỏng → bỏ qua */
    }
  };
  try {
    add(localStorage.getItem(LAST_ACTIVE_KEY));
    addJson(localStorage.getItem(LAST_VIEW_KEY), 'key');
    addJson(localStorage.getItem(CREATE_LAST_KEY), 'projectKey');
  } catch {
    /* storage bị chặn */
  }
  return out;
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
