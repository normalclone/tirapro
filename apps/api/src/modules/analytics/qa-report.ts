/** Hàm thuần của báo cáo QA — tách khỏi Prisma để test trực tiếp. */

type Category = 'TODO' | 'IN_PROGRESS' | 'DONE';

const round2 = (n: number) => Math.round(n * 100) / 100;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Thời gian đóng (giờ) = resolvedAt − createdAt. Bỏ dòng chưa có resolvedAt hoặc mốc âm (dữ liệu nhập lệch). */
export function closeTimeStats(rows: Array<{ createdAt: Date; resolvedAt: Date | null }>): {
  avgHours: number | null;
  medianHours: number | null;
  sample: number;
} {
  const hours = rows.flatMap((r) =>
    r.resolvedAt && r.resolvedAt >= r.createdAt
      ? [(r.resolvedAt.getTime() - r.createdAt.getTime()) / 3_600_000]
      : [],
  );
  if (hours.length === 0) return { avgHours: null, medianHours: null, sample: 0 };
  return {
    avgHours: round2(hours.reduce((a, b) => a + b, 0) / hours.length),
    medianHours: round2(median(hours)),
    sample: hours.length,
  };
}

/** Tỷ lệ mở lại = |đóng ∩ mở lại| / |đóng| (luôn ≤ 1); null khi không có bug đóng trong kỳ. */
export function reopenRate(closed: Set<string>, reopened: Set<string>): number | null {
  if (closed.size === 0) return null;
  let n = 0;
  for (const id of reopened) if (closed.has(id)) n++;
  return n / closed.size;
}

export interface SeverityBucket {
  severityId: string | null;
  name: string;
  color: string | null;
  rank: number;
  open: number;
}

/**
 * Ghép kết quả `groupBy severityId` với danh mục Severity: rank giảm dần, "Chưa đặt" (severityId null) luôn cuối.
 * Id không còn trong danh mục (đã xoá) được gộp vào "Chưa đặt" để tổng vẫn khớp số bug đang mở.
 */
export function bucketOpenBySeverity(
  groups: Array<{ severityId: string | null; count: number }>,
  severities: Array<{ id: string; name: string; color: string | null; rank: number }>,
): SeverityBucket[] {
  const byId = new Map(severities.map((s) => [s.id, s]));
  const known: SeverityBucket[] = [];
  let unset = 0;
  for (const g of groups) {
    const s = g.severityId ? byId.get(g.severityId) : undefined;
    if (s)
      known.push({ severityId: s.id, name: s.name, color: s.color, rank: s.rank, open: g.count });
    else unset += g.count;
  }
  known.sort((a, b) => b.rank - a.rank);
  if (unset > 0) {
    known.push({ severityId: null, name: 'Chưa đặt', color: null, rank: -1, open: unset });
  }
  return known;
}

export interface ReleaseBugRow {
  versionId: string;
  createdAt: Date;
  category: Category;
}
export interface ReleaseVersion {
  id: string;
  name: string;
  status: 'UNRELEASED' | 'RELEASED' | 'ARCHIVED';
  releaseDate: Date | null;
}
export interface ReleaseBucket {
  versionId: string;
  name: string;
  status: 'UNRELEASED' | 'RELEASED' | 'ARCHIVED';
  releaseDate: string | null;
  total: number;
  open: number;
  closed: number;
  leaked: number;
}

/**
 * Gom bug theo phiên bản. `leaked` = bug thuộc phiên bản RELEASED được báo SAU ngày phát hành.
 * Chỉ liệt kê phiên bản có ít nhất một bug; chưa phát hành (không có ngày) lên trước, còn lại theo ngày phát hành mới nhất.
 */
export function bucketByRelease(
  rows: ReleaseBugRow[],
  versions: ReleaseVersion[],
): ReleaseBucket[] {
  const vById = new Map(versions.map((v) => [v.id, v]));
  const acc = new Map<string, ReleaseBucket>();
  for (const r of rows) {
    const v = vById.get(r.versionId);
    if (!v) continue;
    const b = acc.get(v.id) ?? {
      versionId: v.id,
      name: v.name,
      status: v.status,
      releaseDate: v.releaseDate ? v.releaseDate.toISOString() : null,
      total: 0,
      open: 0,
      closed: 0,
      leaked: 0,
    };
    b.total++;
    if (r.category === 'DONE') b.closed++;
    else b.open++;
    if (v.status === 'RELEASED' && v.releaseDate && r.createdAt > v.releaseDate) b.leaked++;
    acc.set(v.id, b);
  }
  return [...acc.values()].sort((a, b) => {
    if (!a.releaseDate !== !b.releaseDate) return a.releaseDate ? 1 : -1;
    if (a.releaseDate && b.releaseDate && a.releaseDate !== b.releaseDate) {
      return a.releaseDate < b.releaseDate ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });
}
