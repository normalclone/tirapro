import { describe, expect, it } from 'vitest';
import type { PortfolioRollup, RollupGroup, RollupProject } from './api';
import { portfolioCsv } from './exportCsv';

const stats = {
  issueCount: 10,
  doneCount: 4,
  inProgressCount: 3,
  todoCount: 3,
  overdueCount: 1,
  progressPct: 40,
};
const project = (key: string, name: string, extra: Partial<RollupProject> = {}): RollupProject => ({
  id: key,
  key,
  name,
  isArchived: false,
  leadName: 'Nguyễn An',
  startDate: '2026-10-01T00:00:00.000Z',
  targetDate: '2026-12-31T00:00:00.000Z',
  ...stats,
  ...extra,
});
const group = (id: string | null, name: string, projects: RollupProject[]): RollupGroup => ({
  id,
  name,
  color: null,
  description: null,
  ownerName: null,
  startDate: null,
  targetDate: null,
  plannedTargetDate: null,
  projectCount: projects.length,
  projects,
  ...stats,
});

const rollup: PortfolioRollup = {
  groups: [
    group('g1', 'Nền tảng thanh toán', [
      project('PAY', 'Cổng thanh toán'),
      project('WAL', 'Ví, nội bộ'),
    ]),
    group(null, 'Chưa thuộc chương trình', [
      project('PSL', 'PSL', { leadName: null, startDate: null, targetDate: null }),
    ]),
  ],
  totals: { ...stats, projectCount: 3, programCount: 1 },
};

describe('portfolioCsv', () => {
  it('mỗi dự án một dòng, có tên chương trình; nhóm "Chưa thuộc chương trình" ghi rõ', () => {
    const csv = portfolioCsv(rollup).replace('﻿', '');
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe(
      'Chương trình,Mã dự án,Tên dự án,Người phụ trách,Tổng việc,Xong,Đang làm,Cần làm,Quá hạn,Tiến độ %,Bắt đầu,Hạn',
    );
    expect(lines).toHaveLength(1 + 3);
    expect(lines[1]).toContain('Nền tảng thanh toán');
    expect(lines[3]).toContain('Chưa thuộc chương trình');
  });
  it('ngày dd/MM/yyyy, thiếu → rỗng; có BOM; tên có dấu phẩy được bọc ngoặc kép', () => {
    const csv = portfolioCsv(rollup);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(lines[1]).toMatch(/,01\/10\/2026,31\/12\/2026$/);
    expect(lines[2]).toContain('"Ví, nội bộ"');
    expect(lines[3]).toMatch(/,PSL,PSL,,10,4,3,3,1,40,,$/);
  });

  it('ngày bắt đầu/hạn là ngày lịch: 23:30Z vẫn ra đúng ngày', () => {
    const csv = portfolioCsv({
      ...rollup,
      groups: [
        group('g1', 'X', [
          project('P1', 'Một', {
            startDate: '2026-10-01T23:30:00.000Z',
            targetDate: '2026-12-31T23:59:59.999Z',
          }),
        ]),
      ],
    });
    expect(csv.replace('\uFEFF', '').trim().split('\r\n')[1]).toMatch(
      /,01\/10\/2026,31\/12\/2026$/,
    );
  });
});
