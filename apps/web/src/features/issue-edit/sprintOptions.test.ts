import { describe, expect, it } from 'vitest';
import type { SprintDto } from '@tirapro/types';
import { BACKLOG_LABEL, buildSprintOptions } from './sprintOptions';

const sp = (id: string, name: string, state: SprintDto['state']) =>
  ({ id, name, state }) as SprintDto;
const sprints = [
  sp('s1', 'Sprint 1', 'CLOSED'),
  sp('s2', 'Sprint 2', 'ACTIVE'),
  sp('s3', 'Sprint 3', 'FUTURE'),
];

describe('buildSprintOptions', () => {
  it('issue ở sprint đã đóng: hiện đúng tên, không phải Việc chờ', () => {
    const o = buildSprintOptions(sprints, 's1');
    expect(o.find((x) => x.value === 's1')?.label).toBe('Sprint 1 · đã đóng');
  });
  it('sprint đóng không phải sprint hiện tại: không cho chuyển vào', () => {
    expect(buildSprintOptions(sprints, null).map((o) => o.value)).toEqual(['', 's2', 's3']);
    expect(buildSprintOptions(sprints, 's3').map((o) => o.value)).toEqual(['', 's2', 's3']);
  });
  it('nhãn đang chạy; backlog khi không có sprintId', () => {
    const o = buildSprintOptions(sprints, null);
    expect(o[0]).toEqual({ value: '', label: BACKLOG_LABEL });
    expect(o.find((x) => x.value === 's2')?.label).toBe('Sprint 2 · đang chạy');
  });
  it('chưa tải danh sách / sprint không còn: nhãn trung tính, không nhầm thành Việc chờ', () => {
    expect(buildSprintOptions(undefined, 'sX').find((o) => o.value === 'sX')?.label).toBe(
      'Đang tải sprint…',
    );
    expect(buildSprintOptions(sprints, 'sX').find((o) => o.value === 'sX')?.label).toBe(
      'Sprint không xác định',
    );
  });
});
