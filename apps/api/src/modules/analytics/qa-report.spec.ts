import { describe, expect, it } from 'vitest';
import {
  bucketOpenBySeverity,
  closeTimeFromRow,
  mapReleaseRows,
  parseQaRange,
  reopenRate,
} from './qa-report';

describe('closeTimeFromRow', () => {
  it('làm tròn 2 số, chấp nhận bigint/chuỗi từ Postgres', () => {
    expect(closeTimeFromRow({ n: 5n, avgHours: 225.6099, medianHours: '72.015' })).toEqual({
      avgHours: 225.61,
      medianHours: 72.02,
      sample: 5,
    });
  });
  it('không có mẫu (n=0, null, hoặc không có dòng) => null/0', () => {
    expect(closeTimeFromRow({ n: 0, avgHours: null, medianHours: null })).toEqual({
      avgHours: null,
      medianHours: null,
      sample: 0,
    });
    expect(closeTimeFromRow(undefined)).toEqual({ avgHours: null, medianHours: null, sample: 0 });
  });
});

describe('reopenRate', () => {
  it('(đóng ∩ mở lại) / đóng; null khi không có bug đóng; không vượt 1', () => {
    expect(reopenRate(4, 1)).toBe(0.25);
    expect(reopenRate(0, 3)).toBeNull();
    expect(reopenRate(2, 5)).toBe(1);
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

describe('mapReleaseRows', () => {
  const v = (id: string, status: 'UNRELEASED' | 'RELEASED', releaseDate: string | null) => ({
    id,
    name: id,
    status,
    releaseDate: releaseDate ? new Date(releaseDate) : null,
  });
  it('ghép tên/trạng thái, ép số, chưa phát hành lên trước rồi ngày mới nhất', () => {
    const out = mapReleaseRows(
      [
        { versionId: 'v1', total: 2n, open: 1n, closed: 1n, leaked: 1n },
        { versionId: 'v2', total: 1, open: 1, closed: 0, leaked: 0 },
        { versionId: 'v0', total: 3, open: 0, closed: 3, leaked: 0 },
      ],
      [
        v('v0', 'RELEASED', '2026-09-01'),
        v('v1', 'RELEASED', '2026-10-01'),
        v('v2', 'UNRELEASED', null),
      ],
    );
    expect(out.map((r) => r.versionId)).toEqual(['v2', 'v1', 'v0']);
    expect(out[1]).toMatchObject({ total: 2, open: 1, closed: 1, leaked: 1, status: 'RELEASED' });
  });
  it('bỏ dòng của phiên bản không còn / không có bug', () => {
    expect(
      mapReleaseRows([{ versionId: 'x', total: 1, open: 1, closed: 0, leaked: 0 }], []),
    ).toEqual([]);
    expect(mapReleaseRows([], [v('v1', 'RELEASED', '2026-10-01')])).toEqual([]);
  });
});

describe('parseQaRange', () => {
  const now = new Date('2026-10-16T05:00:00.000Z');
  it('YYYY-MM-DD = trọn ngày UTC', () => {
    expect(parseQaRange('2026-10-01', '2026-10-15', now)).toEqual({
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-10-15T23:59:59.999Z'),
    });
  });
  it('ISO đầy đủ có múi giờ được dùng nguyên văn (ranh giới ngày theo giờ địa phương)', () => {
    expect(parseQaRange('2026-10-10T00:00:00+07:00', '2026-10-16T23:59:59.999+07:00', now)).toEqual(
      {
        from: new Date('2026-10-09T17:00:00.000Z'),
        to: new Date('2026-10-16T16:59:59.999Z'),
      },
    );
  });
  it('sự kiện 00:00-07:00 giờ địa phương nằm trong kỳ, 23:59:59.999 ngày trước thì không', () => {
    const r = parseQaRange('2026-10-10T00:00:00+07:00', undefined, now);
    if ('error' in r) throw new Error(r.error);
    expect(new Date('2026-10-09T17:00:00.000Z') >= r.from).toBe(true); // 00:00 địa phương
    expect(new Date('2026-10-09T16:59:59.999Z') >= r.from).toBe(false); // 23:59:59.999 ngày trước
  });
  it('mặc định 30 ngày tới now, bắt đầu đầu ngày UTC', () => {
    expect(parseQaRange(undefined, undefined, now)).toEqual({
      from: new Date('2026-09-17T00:00:00.000Z'),
      to: now,
    });
  });
  it('sai định dạng, ngày không tồn tại, đảo ngược, quá 366 ngày => lỗi', () => {
    for (const [f, t] of [
      ['abc', undefined],
      ['1/2/2026', undefined],
      ['2026-02-30', undefined],
      ['2026-10-10T00:00:00', undefined], // thiếu múi giờ
      ['2026-10-10', '2026-10-01'],
      ['2024-01-01', '2026-10-01'],
    ] as const) {
      expect(parseQaRange(f, t, now)).toHaveProperty('error');
    }
  });
});
