import { APP_NAV_LABELS } from '@/lib/navLabels';
import { normalizeVi } from '@/lib/text';
import { PROJECT_VIEW_ENTRIES } from '@/features/projects/projectTabs';

export interface RouteEntry {
  path: string;
  label: string;
  /** Từ khoá phụ (đã gõ thường, có thể có dấu) để khớp thêm ngoài đoạn đầu của path và nhãn. */
  keywords?: string[];
}

/**
 * Các trang cấp cao người dùng gõ tay/nhớ. Nhãn lấy từ `lib/navLabels.ts` (một nguồn với menu).
 * Không đưa `/admin/*`: console quản trị chỉ dành admin hệ thống, không gợi ý cho người gõ nhầm.
 */
export const ROUTE_CATALOG: readonly RouteEntry[] = [
  { path: '/', label: APP_NAV_LABELS.home, keywords: ['dashboard', 'home', 'trang chu'] },
  { path: '/projects', label: APP_NAV_LABELS.projects, keywords: ['project', 'du an'] },
  { path: '/filters', label: APP_NAV_LABELS.filters, keywords: ['filter', 'bo loc', 'search'] },
  {
    path: '/members',
    label: APP_NAV_LABELS.members,
    keywords: ['member', 'users', 'people', 'thanh vien'],
  },
  { path: '/manage', label: APP_NAV_LABELS.manage, keywords: ['portfolio', 'danh muc', 'quan ly'] },
  { path: '/wiki', label: APP_NAV_LABELS.wiki, keywords: ['docs', 'tai lieu'] },
  {
    path: '/connect',
    label: APP_NAV_LABELS.connect,
    keywords: ['automation', 'integrations', 'ket noi'],
  },
  { path: '/settings', label: APP_NAV_LABELS.settings, keywords: ['setting', 'config', 'cai dat'] },
  {
    path: '/notifications',
    label: APP_NAV_LABELS.notifications,
    keywords: ['notification', 'thong bao'],
  },
  { path: '/account', label: APP_NAV_LABELS.account, keywords: ['profile', 'tai khoan'] },
  { path: '/documentation', label: APP_NAV_LABELS.documentation, keywords: ['help', 'huong dan'] },
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

/** Xếp hạng `catalog` theo độ gần của `segment` (đã bỏ dấu/hạ thường); loại mục có path = `pathname`. */
function rankEntries(
  segment: string,
  pathname: string,
  catalog: readonly RouteEntry[],
  limit: number,
): RouteEntry[] {
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
  return rankEntries(normalizeVi(decodeSafe(first)), pathname, catalog, limit);
}

/** Mã dự án của đường dẫn dạng `/p/KEY` hoặc `/p/KEY/…`; ngoài dự án → null. */
export function projectKeyOf(pathname: string): string | null {
  return /^\/p\/([^/]+)(?:\/|$)/.exec(pathname)?.[1] ?? null;
}

/** Tối đa `limit` màn trong dự án gần đoạn thứ ba của `/p/KEY/<gõ>` (đường dẫn gợi ý giữ nguyên mã dự án). */
export function suggestProjectViews(pathname: string, limit = 3): RouteEntry[] {
  const key = projectKeyOf(pathname);
  if (!key) return [];
  // `rankEntries` so với đoạn ĐẦU của path (= `p`) nên đưa `seg` vào từ khoá để khớp tên màn (backlog, reports…).
  const catalog = PROJECT_VIEW_ENTRIES.map((v) => ({
    path: `/p/${key}/${v.seg}`,
    label: v.label,
    keywords: [v.seg, ...v.keywords],
  }));
  const third = pathname.split('/')[3] ?? '';
  return rankEntries(normalizeVi(decodeSafe(third)), pathname, catalog, limit);
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
