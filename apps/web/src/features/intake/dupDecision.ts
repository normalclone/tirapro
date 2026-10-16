/** Bỏ dấu tiếng Việt, hạ chữ, gộp khoảng trắng — cùng quy tắc so tiêu đề giống hệt với BE (`normalizeVi`). */
export const foldVi = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export const isExactTitle = (a: string, b: string): boolean => foldVi(a) === foldVi(b);

/** Lựa chọn của người dùng trước một gợi ý trùng. */
export type DupSelection =
  | { mode: 'none' }
  | { mode: 'new' }
  | { mode: 'merge'; key: string; id?: string };

export function submitLabel(
  sel: DupSelection,
  top: { key: string; exact: boolean } | null,
): string {
  if (sel.mode === 'merge') return `Thêm vào ${sel.key}`;
  if (sel.mode === 'new') return top?.exact ? 'Gửi (tạo mới)' : 'Gửi';
  return top?.exact ? `Gửi (thêm vào ${top.key})` : 'Gửi';
}

/** Phần của một gợi ý trùng mà quyết định cần tới. */
export interface DupMatch {
  id: string;
  key: string;
  summary: string;
  triageState: string | null;
  status: { category: string };
}

/** Giống định nghĩa "còn sống" của BE: chờ/hoãn triage hoặc trạng thái chưa Done. */
const isLive = (m: DupMatch): boolean =>
  m.triageState === 'PENDING' || m.triageState === 'SNOOZED' || m.status.category !== 'DONE';

export interface DupDecision {
  /** Bug còn sống có tiêu đề giống hệt (server sẽ gộp tự động nếu người dùng không nói gì). */
  exact: DupMatch | undefined;
  label: string;
  /** Bug sẽ nhận ghi chú (đặt `mergeIntoIssueId` rõ ràng để tệp tải đúng bug đích); null = tạo mới. */
  mergeInto: { id: string; key: string } | null;
  forceNew: boolean;
}

/**
 * Quyết định gửi: người dùng chọn gộp → gộp vào bug đó; "vẫn tạo mới" → forceNew; chưa chọn mà tiêu đề giống hệt
 * một bug còn sống → gộp vào bug đó một cách TƯỜNG MINH (cùng kết quả server tự gộp, nhưng ảnh/tệp tải được lên đúng
 * chỗ) và nhãn nút nói rõ trước — người dùng không bao giờ bị bất ngờ.
 */
export function dupDecision(sel: DupSelection, matches: DupMatch[], summary: string): DupDecision {
  const exact = matches.find((m) => isExactTitle(m.summary, summary) && isLive(m));
  const label = submitLabel(sel, exact ? { key: exact.key, exact: true } : null);
  if (sel.mode === 'merge') {
    const id = sel.id ?? matches.find((m) => m.key === sel.key)?.id;
    return { exact, label, mergeInto: id ? { id, key: sel.key } : null, forceNew: false };
  }
  if (sel.mode === 'new') return { exact, label, mergeInto: null, forceNew: true };
  return {
    exact,
    label,
    mergeInto: exact ? { id: exact.id, key: exact.key } : null,
    forceNew: false,
  };
}
