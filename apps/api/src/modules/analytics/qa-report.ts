/** Hàm thuần của báo cáo QA — phần còn lại (đếm, trung vị, gom theo phiên bản) do SQL aggregate lo, không có trần dòng. */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Dòng kết quả SQL: số lượng có thể là bigint, giá trị thời gian có thể null/chuỗi (numeric). */
type Num = number | bigint | string | null;
const num = (v: Num): number => (v == null ? 0 : Number(v));

/** Thống kê thời gian đóng (giờ) từ dòng aggregate; không có mẫu → null. */
export function closeTimeFromRow(row: { n: Num; avgHours: Num; medianHours: Num } | undefined): {
  avgHours: number | null;
  medianHours: number | null;
  sample: number;
} {
  const sample = num(row?.n ?? 0);
  if (!row || sample === 0 || row.avgHours == null || row.medianHours == null) {
    return { avgHours: null, medianHours: null, sample: 0 };
  }
  return {
    avgHours: round2(num(row.avgHours)),
    medianHours: round2(num(row.medianHours)),
    sample,
  };
}

/** Tỷ lệ mở lại = (bug đóng VÀ mở lại trong kỳ) / (bug đóng trong kỳ) (luôn ≤ 1); null khi không có bug đóng. */
export function reopenRate(closed: number, closedAndReopened: number): number | null {
  if (closed <= 0) return null;
  return Math.min(1, closedAndReopened / closed);
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

export interface ReleaseAggRow {
  versionId: string;
  total: Num;
  open: Num;
  closed: Num;
  leaked: Num;
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
 * Ghép dòng aggregate theo phiên bản với tên/trạng thái/ngày phát hành. Chỉ liệt kê phiên bản có bug;
 * chưa có ngày phát hành lên trước, còn lại theo ngày phát hành mới nhất.
 */
export function mapReleaseRows(rows: ReleaseAggRow[], versions: ReleaseVersion[]): ReleaseBucket[] {
  const vById = new Map(versions.map((v) => [v.id, v]));
  const out: ReleaseBucket[] = [];
  for (const r of rows) {
    const v = vById.get(r.versionId);
    if (!v || num(r.total) === 0) continue;
    out.push({
      versionId: v.id,
      name: v.name,
      status: v.status,
      releaseDate: v.releaseDate ? v.releaseDate.toISOString() : null,
      total: num(r.total),
      open: num(r.open),
      closed: num(r.closed),
      leaked: num(r.leaked),
    });
  }
  return out.sort((a, b) => {
    if (!a.releaseDate !== !b.releaseDate) return a.releaseDate ? 1 : -1;
    if (a.releaseDate && b.releaseDate && a.releaseDate !== b.releaseDate) {
      return a.releaseDate < b.releaseDate ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });
}

const DAY = 86_400_000;
const MAX_RANGE_DAYS = 366;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export type QaRangeResult = { from: Date; to: Date } | { error: string };

/**
 * Khoảng thời gian của báo cáo. `YYYY-MM-DD` = trọn ngày theo UTC (đầu ngày / cuối ngày); ISO đầy đủ có múi giờ
 * (`2026-10-10T00:00:00+07:00`, `…Z`) được dùng NGUYÊN VĂN để client chọn ranh giới ngày theo giờ địa phương.
 * Mặc định: 30 ngày tính tới `now`. Lỗi trả `{ error }` để nơi gọi ném 422.
 */
export function parseQaRange(
  fromStr: string | undefined,
  toStr: string | undefined,
  now: Date,
): QaRangeResult {
  const parse = (s: string, end: boolean): Date | null => {
    if (DATE_ONLY.test(s)) {
      const d = new Date(`${s}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
      return end ? new Date(d.getTime() + DAY - 1) : d;
    }
    if (!ISO_INSTANT.test(s)) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const to = toStr ? parse(toStr, true) : now;
  if (!to) return { error: 'Khoảng thời gian không hợp lệ' };
  let from: Date | null;
  if (fromStr) from = parse(fromStr, false);
  else {
    const d = new Date(to.getTime() - 29 * DAY);
    from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  if (!from) return { error: 'Khoảng thời gian không hợp lệ' };
  if (from > to) return { error: 'Ngày bắt đầu phải trước ngày kết thúc' };
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY) {
    return { error: `Khoảng thời gian tối đa ${MAX_RANGE_DAYS} ngày` };
  }
  return { from, to };
}
