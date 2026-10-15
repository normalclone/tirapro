import { describe, expect, it } from 'vitest';
import type { RaidItemDto } from './api';
import { raidCsv } from './exportCsv';

const item = (extra: Partial<RaidItemDto>): RaidItemDto => ({
  id: 'r1',
  workspaceId: 'w',
  projectId: 'p1',
  project: { id: 'p1', key: 'PAY', name: 'Cổng thanh toán' },
  kind: 'RISK',
  title: 'Mất người chủ chốt',
  description: null,
  probability: 5,
  impact: 4,
  status: 'OPEN',
  owner: { id: 'u', displayName: 'Trần Bình', email: 'b@x.vn', avatarUrl: null },
  mitigation: 'Đào tạo người thay thế',
  dueDate: '2026-11-05T00:00:00.000Z',
  score: 20,
  level: 'CRITICAL',
  levelLabel: 'Nghiêm trọng',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...extra,
});

describe('raidCsv', () => {
  it('header đúng, điểm 20+ ghi mức "Nghiêm trọng", nhãn tiếng Việt cho loại/trạng thái', () => {
    const lines = raidCsv([item({})])
      .replace('﻿', '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toBe(
      'Loại,Tiêu đề,Dự án,Xác suất,Ảnh hưởng,Điểm,Mức,Trạng thái,Người phụ trách,Hạn,Biện pháp',
    );
    expect(lines[1]).toBe(
      'Rủi ro,Mất người chủ chốt,Cổng thanh toán,5,4,20,Nghiêm trọng,Chưa xử lý,Trần Bình,05/11/2026,Đào tạo người thay thế',
    );
  });
  it('thiếu dự án/người/hạn → ô rỗng; chống CSV-injection ở tiêu đề', () => {
    const lines = raidCsv([
      item({
        project: null,
        owner: null,
        dueDate: null,
        mitigation: null,
        title: '=HYPERLINK("x")',
      }),
    ])
      .replace('﻿', '')
      .trim()
      .split('\r\n');
    expect(lines[1]!.startsWith(`Rủi ro,"'=HYPERLINK(""x"")",,5,4,20,`)).toBe(true);
    expect(lines[1]!.endsWith(',,,')).toBe(true);
  });
});
