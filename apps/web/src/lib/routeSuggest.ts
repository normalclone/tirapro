import { normalizeVi } from '@/lib/text';

export interface RouteEntry {
  path: string;
  label: string;
  /** Từ khoá phụ (đã gõ thường, có thể có dấu) để khớp thêm ngoài đoạn đầu của path và nhãn. */
  keywords?: string[];
}

/**
 * Các trang cấp cao người dùng gõ tay/nhớ. Nhãn = nhãn menu hiện tại (Task 11 sẽ gom về một nguồn duy nhất).
 * Không đưa `/admin/*`: console quản trị chỉ dành admin hệ thống, không gợi ý cho người gõ nhầm.
 */
export const ROUTE_CATALOG: readonly RouteEntry[] = [
  { path: '/', label: 'Tổng quan', keywords: ['dashboard', 'home', 'trang chu'] },
  { path: '/projects', label: 'Dự án', keywords: ['project', 'du an'] },
  { path: '/filters', label: 'Bộ lọc đã lưu', keywords: ['filter', 'bo loc', 'search'] },
  { path: '/members', label: 'Thành viên', keywords: ['member', 'users', 'people', 'thanh vien'] },
  { path: '/manage', label: 'Danh mục', keywords: ['portfolio', 'danh muc', 'quan ly'] },
  { path: '/wiki', label: 'Wiki', keywords: ['docs', 'tai lieu'] },
  { path: '/connect', label: 'Kết nối', keywords: ['automation', 'integrations', 'ket noi'] },
  { path: '/settings', label: 'Cài đặt', keywords: ['setting', 'config', 'cai dat'] },
  { path: '/notifications', label: 'Thông báo', keywords: ['notification', 'thong bao'] },
  { path: '/account', label: 'Tài khoản', keywords: ['profile', 'tai khoan'] },
  { path: '/documentation', label: 'Tài liệu hướng dẫn', keywords: ['help', 'huong dan'] },
];

/** Khoảng cách Levenshtein (số phép chèn/xoá/thay ký tự tối thiểu). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Khoảng cách giữa đoạn người dùng gõ và một cụm đích; gõ dở (tiền tố ≥ 2 ký tự) coi là khớp. Vượt ngưỡng → Infinity. */
function termDistance(segment: string, term: string): number {
  if (!term) return Infinity;
  if (segment.length >= 2 && term.startsWith(segment)) return 0;
  const d = levenshtein(segment, term);
  return d <= Math.max(2, Math.floor(term.length * 0.4)) ? d : Infinity;
}

/**
 * Tối đa `limit` route gần `pathname` nhất, so khớp đoạn đầu của path (bỏ dấu, không phân biệt hoa thường) với
 * đoạn đầu path, nhãn và từ khoá của từng mục. Mục xa quá ngưỡng bị bỏ; không bao giờ trả chính `pathname`.
 */
export function suggestRoutes(
  pathname: string,
  catalog: readonly RouteEntry[] = ROUTE_CATALOG,
  limit = 3,
): RouteEntry[] {
  const first = pathname.split('/').find(Boolean) ?? '';
  const segment = normalizeVi(decodeSafe(first));
  if (!segment) return [];
  const scored: { entry: RouteEntry; d: number; i: number }[] = [];
  catalog.forEach((entry, i) => {
    if (entry.path === pathname) return;
    const terms = [
      normalizeVi(entry.path.split('/').find(Boolean) ?? ''),
      normalizeVi(entry.label),
      ...(entry.keywords ?? []).map(normalizeVi),
    ];
    const d = Math.min(...terms.map((t) => termDistance(segment, t)));
    if (Number.isFinite(d)) scored.push({ entry, d, i });
  });
  return scored
    .sort((x, y) => x.d - y.d || x.i - y.i)
    .slice(0, limit)
    .map((s) => s.entry);
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
