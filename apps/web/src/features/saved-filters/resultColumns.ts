import type { IssueDto } from '@tirapro/types';
import { fmtDate } from '@/lib/dateFormat';

/**
 * Cột của bảng kết quả JQL/bộ lọc. MỘT nguồn `cellText` cho cả ô bảng lẫn xuất CSV (L2) để hai nơi cùng chữ.
 * Không có cột Sprint: `IssueDto` chỉ có `sprintId` (không có tên), tránh gọi thêm API.
 */
export type ResultColumnId =
  | 'key'
  | 'summary'
  | 'type'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'reporter'
  | 'points'
  | 'due'
  | 'updated'
  | 'project'
  | 'severity';

export interface ResultColumnDef {
  id: ResultColumnId;
  /** Tiêu đề cột (cũng là tiêu đề cột CSV). */
  label: string;
  /** `key`/`summary` luôn bật, không tắt được. */
  locked?: boolean;
}

/** Thứ tự chuẩn của cột (bảng hiển thị theo thứ tự này, không theo thứ tự bấm chọn). */
export const RESULT_COLUMNS: readonly ResultColumnDef[] = [
  { id: 'key', label: 'Mã', locked: true },
  { id: 'summary', label: 'Tiêu đề', locked: true },
  { id: 'type', label: 'Loại' },
  { id: 'status', label: 'Trạng thái' },
  { id: 'priority', label: 'Ưu tiên' },
  { id: 'assignee', label: 'Người được giao' },
  { id: 'reporter', label: 'Người báo' },
  { id: 'points', label: 'Điểm' },
  { id: 'due', label: 'Hạn' },
  { id: 'updated', label: 'Cập nhật' },
  { id: 'project', label: 'Dự án' },
  { id: 'severity', label: 'Mức nghiêm trọng' },
];

export const DEFAULT_RESULT_COLUMNS: ResultColumnId[] = [
  'key',
  'summary',
  'status',
  'priority',
  'assignee',
  'points',
  'due',
];

const KNOWN = new Set<string>(RESULT_COLUMNS.map((c) => c.id));
const LOCKED_IDS: ResultColumnId[] = RESULT_COLUMNS.filter((c) => c.locked).map((c) => c.id);
const isLocked = (id: ResultColumnId) => LOCKED_IDS.includes(id);

/**
 * Danh sách cột đã lưu (dữ liệu bất kỳ) → danh sách hợp lệ, GIỮ thứ tự đã lưu:
 * - bỏ id lạ / trùng / không phải chuỗi; luôn có `key` + `summary` ghim ở đầu (theo thứ tự chuẩn);
 * - `knownIds` = các cột mà bố cục lúc LƯU đã biết: cột MẶC ĐỊNH nào không nằm trong đó (mới thêm sau khi lưu) được nối
 *   vào cuối; cột người dùng đã ẩn (có trong `knownIds`) thì không hiện lại. Không truyền `knownIds` (dữ liệu cũ) → không nối;
 * - không có id hợp lệ nào (hỏng / rỗng) → bản sao của mặc định.
 */
export function normalizeColumns(input: unknown, knownIds?: readonly string[]): ResultColumnId[] {
  if (!Array.isArray(input)) return [...DEFAULT_RESULT_COLUMNS];
  const seen = new Set<ResultColumnId>();
  for (const x of input) if (typeof x === 'string' && KNOWN.has(x)) seen.add(x as ResultColumnId);
  if (seen.size === 0) return [...DEFAULT_RESULT_COLUMNS];
  const rest = [...seen].filter((id) => !isLocked(id));
  const known = knownIds ? new Set(knownIds) : null;
  if (known)
    for (const id of DEFAULT_RESULT_COLUMNS)
      if (!isLocked(id) && !known.has(id) && !seen.has(id)) rest.push(id);
  return [...LOCKED_IDS, ...rest];
}

/** Dữ liệu lưu → `{ columns, known }`; hỗ trợ dạng cũ (mảng thuần) và dạng v2 (`{columns, known}`). Hỏng → null. */
function parseSaved(raw: string | null): { columns: unknown; known?: readonly string[] } | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) return { columns: parsed };
  if (parsed && typeof parsed === 'object') {
    const o = parsed as { columns?: unknown; known?: unknown };
    if (!Array.isArray(o.columns)) return null;
    const known = Array.isArray(o.known)
      ? o.known.filter((x): x is string => typeof x === 'string')
      : undefined;
    return { columns: o.columns, known };
  }
  return null;
}

/** Cột đã lưu (chuỗi JSON) → danh sách hợp lệ giữ thứ tự (xem `normalizeColumns`). Rỗng/hỏng → mặc định. */
export function readColumns(raw: string | null): ResultColumnId[] {
  const saved = parseSaved(raw);
  return saved ? normalizeColumns(saved.columns, saved.known) : [...DEFAULT_RESULT_COLUMNS];
}

// ----- Thao tác thuần trên thứ tự cột (không sửa mảng vào; không đổi được → trả NGUYÊN tham chiếu) -----

/** Có dời được `id` một ô theo `dir` (-1 trái, +1 phải)? Cột khoá bị ghim; cột thường không lọt vào vùng ghim. */
export function canMoveColumn(cols: readonly ResultColumnId[], id: ResultColumnId, dir: -1 | 1) {
  const i = cols.indexOf(id);
  if (i < 0 || isLocked(id)) return false;
  const j = i + dir;
  return j >= 0 && j < cols.length && !isLocked(cols[j]!);
}

export function moveColumn(
  cols: ResultColumnId[],
  id: ResultColumnId,
  dir: -1 | 1,
): ResultColumnId[] {
  if (!canMoveColumn(cols, id, dir)) return cols;
  const i = cols.indexOf(id);
  const next = [...cols];
  [next[i], next[i + dir]] = [next[i + dir]!, next[i]!];
  return next;
}

/** Ẩn được khi: đang hiện, không phải cột khoá, và còn ít nhất một cột khác. */
export function canHideColumn(cols: readonly ResultColumnId[], id: ResultColumnId) {
  return cols.includes(id) && !isLocked(id) && cols.length > 1;
}

export function hideColumn(cols: ResultColumnId[], id: ResultColumnId): ResultColumnId[] {
  return canHideColumn(cols, id) ? cols.filter((c) => c !== id) : cols;
}

/** Hiện lại cột: chèn ngay sau `afterId` (cột đang mở menu) nếu có, không thì nối cuối. Id lạ/đã hiện → không đổi. */
export function showColumn(
  cols: ResultColumnId[],
  id: ResultColumnId,
  afterId?: ResultColumnId,
): ResultColumnId[] {
  if (!KNOWN.has(id) || cols.includes(id)) return cols;
  const at = afterId === undefined ? -1 : cols.indexOf(afterId);
  if (at < 0) return [...cols, id];
  return [...cols.slice(0, at + 1), id, ...cols.slice(at + 1)];
}

/** Bật/tắt từ hộp chọn cột: bật → nối cuối; tắt → bỏ (cột khoá không đổi). */
export function toggleColumn(cols: ResultColumnId[], id: ResultColumnId): ResultColumnId[] {
  if (!KNOWN.has(id) || isLocked(id)) return cols;
  return cols.includes(id) ? hideColumn(cols, id) : showColumn(cols, id);
}

/** Cột đang ẩn, theo thứ tự chuẩn. */
export function hiddenColumns(cols: readonly ResultColumnId[]): ResultColumnDef[] {
  return RESULT_COLUMNS.filter((c) => !cols.includes(c.id));
}

export function isDefaultColumns(cols: readonly ResultColumnId[]): boolean {
  return (
    cols.length === DEFAULT_RESULT_COLUMNS.length &&
    cols.every((c, i) => c === DEFAULT_RESULT_COLUMNS[i])
  );
}

/** Chuỗi thuần của một ô (hiển thị và CSV). Thiếu giá trị → '' (không bao giờ "undefined"/"null"). */
export function cellText(
  issue: IssueDto,
  col: ResultColumnId,
  ctx: { projectKeyById: Map<string, string> },
): string {
  switch (col) {
    case 'key':
      return issue.key ?? '';
    case 'summary':
      return issue.summary ?? '';
    case 'type':
      return issue.type?.name ?? '';
    case 'status':
      return issue.status?.name ?? '';
    case 'priority':
      return issue.priority?.name ?? '';
    case 'assignee':
      return issue.assignee?.displayName ?? '';
    case 'reporter':
      return issue.reporter?.displayName ?? '';
    case 'points':
      return issue.storyPoints === null || issue.storyPoints === undefined
        ? ''
        : String(issue.storyPoints);
    case 'due':
      return issue.dueDate ? fmtDate(issue.dueDate) : '';
    case 'updated':
      return issue.updatedAt ? fmtDate(issue.updatedAt) : '';
    case 'project':
      return ctx.projectKeyById.get(issue.projectId) ?? '';
    case 'severity':
      return issue.severity?.name ?? '';
  }
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Khoá CŨ (một lựa chọn cho cả người dùng) — chỉ ĐỌC làm giá trị khởi đầu cho bộ lọc chưa có bố cục riêng. */
export const columnsStorageKey = (userId: string) => `tirapro:jqlColumns:v1:${userId}`;

/**
 * Khoá bố cục theo người dùng + phạm vi: `adhoc` (truy vấn JQL nhanh) hoặc `filter:<id>` (bộ lọc đã lưu). Bộ lọc đã lưu
 * chưa có trường cột ở máy chủ (không thêm API/DB ở đợt này) nên bố cục được nhớ trong trình duyệt.
 */
export const scopedColumnsKey = (userId: string, scope: string) =>
  `tirapro:jqlColumns:v2:${userId}:${scope}`;

/**
 * Đọc bố cục: riêng của phạm vi → lựa chọn cũ của người dùng (v1) → mặc định. Storage bị chặn/hỏng → mặc định.
 * `localStorage` được chạm BÊN TRONG `try` (không dùng default parameter): khi trình duyệt chặn dữ liệu site, chỉ việc đọc
 * `window.localStorage` đã ném SecurityError.
 */
export function loadColumns(
  userId: string,
  scope: string,
  storage?: StorageLike,
): ResultColumnId[] {
  try {
    const st = storage ?? localStorage;
    const own = parseSaved(st.getItem(scopedColumnsKey(userId, scope)));
    if (own) return normalizeColumns(own.columns, own.known);
    return readColumns(st.getItem(columnsStorageKey(userId)));
  } catch {
    return [...DEFAULT_RESULT_COLUMNS];
  }
}

/** Lưu bố cục kèm danh sách cột đã biết lúc lưu (để về sau nối cột mặc định MỚI mà không hiện lại cột đã ẩn). */
export function saveColumns(
  userId: string,
  scope: string,
  columns: ResultColumnId[],
  storage?: StorageLike,
): void {
  try {
    (storage ?? localStorage).setItem(
      scopedColumnsKey(userId, scope),
      JSON.stringify({ columns, known: RESULT_COLUMNS.map((c) => c.id) }),
    );
  } catch {
    /* storage bị chặn: bỏ qua, lựa chọn chỉ có hiệu lực trong phiên */
  }
}
