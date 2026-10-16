import { describe, expect, it } from 'vitest';
import { bucketByRelease, bucketOpenBySeverity, closeTimeStats, reopenRate } from './qa-report';

const H = 3_600_000;
describe('closeTimeStats', () => {
  it('trung bình và trung vị theo giờ, bỏ dòng thiếu mốc/âm', () => {
    const t0 = new Date('2026-10-01T00:00:00Z');
    const rows = [
      { createdAt: t0, resolvedAt: new Date(t0.getTime() + 2 * H) },
      { createdAt: t0, resolvedAt: new Date(t0.getTime() + 4 * H) },
      { createdAt: t0, resolvedAt: new Date(t0.getTime() + 24 * H) },
      { createdAt: t0, resolvedAt: null },
      { createdAt: new Date(t0.getTime() + H), resolvedAt: t0 },
    ];
    expect(closeTimeStats(rows)).toEqual({ avgHours: 10, medianHours: 4, sample: 3 });
    expect(closeTimeStats([])).toEqual({ avgHours: null, medianHours: null, sample: 0 });
  });
  it('trung vị của số lượng chẵn là trung bình hai giá trị giữa', () => {
    const t0 = new Date('2026-10-01T00:00:00Z');
    const rows = [1, 3, 5, 100].map((h) => ({
      createdAt: t0,
      resolvedAt: new Date(t0.getTime() + h * H),
    }));
    expect(closeTimeStats(rows).medianHours).toBe(4);
  });
});

describe('reopenRate', () => {
  it('giao tập đã mở lại với tập đã đóng; null khi không có bug đóng', () => {
    expect(reopenRate(new Set(['a', 'b', 'c', 'd']), new Set(['b', 'x']))).toBe(0.25);
    expect(reopenRate(new Set(), new Set(['x']))).toBeNull();
  });
});

describe('bucketOpenBySeverity', () => {
  it('ghép tên/màu, "Chưa đặt" cho severityId null, sắp theo rank giảm, chưa đặt cuối', () => {
    const out = bucketOpenBySeverity(
      [
        { severityId: 's1', count: 3 },
        { severityId: null, count: 2 },
        { severityId: 's2', count: 1 },
      ],
      [
        { id: 's1', name: 'Critical', color: 'c', rank: 4 },
        { id: 's2', name: 'Minor', color: null, rank: 2 },
      ],
    );
    expect(out.map((o) => [o.name, o.open])).toEqual([
      ['Critical', 3],
      ['Minor', 1],
      ['Chưa đặt', 2],
    ]);
  });
  it('mức bị xoá khỏi danh mục (id không còn) được gộp vào "Chưa đặt"', () => {
    const out = bucketOpenBySeverity(
      [
        { severityId: 'gone', count: 2 },
        { severityId: null, count: 1 },
      ],
      [],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severityId: null, name: 'Chưa đặt', open: 3 });
  });
});

describe('bucketByRelease', () => {
  const v = (id: string, status: 'UNRELEASED' | 'RELEASED', releaseDate: string | null) => ({
    id,
    name: id,
    status,
    releaseDate: releaseDate ? new Date(releaseDate) : null,
  });
  it('đếm tổng/mở/đóng và rò rỉ (tạo sau ngày phát hành của bản RELEASED)', () => {
    const rows = [
      { versionId: 'v1', createdAt: new Date('2026-09-01'), category: 'DONE' as const },
      { versionId: 'v1', createdAt: new Date('2026-10-05'), category: 'TODO' as const },
      { versionId: 'v2', createdAt: new Date('2026-10-05'), category: 'TODO' as const },
    ];
    const out = bucketByRelease(rows, [
      v('v1', 'RELEASED', '2026-10-01'),
      v('v2', 'UNRELEASED', null),
    ]);
    expect(out.find((r) => r.versionId === 'v1')).toMatchObject({
      total: 2,
      open: 1,
      closed: 1,
      leaked: 1,
    });
    expect(out.find((r) => r.versionId === 'v2')).toMatchObject({ total: 1, leaked: 0 });
  });
  it('phiên bản không có bug vẫn bị bỏ (chỉ liệt kê phiên bản có dữ liệu)', () => {
    const out = bucketByRelease([], [v('v1', 'RELEASED', '2026-10-01')]);
    expect(out).toEqual([]);
  });
});
