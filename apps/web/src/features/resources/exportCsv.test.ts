import { describe, expect, it } from 'vitest';
import type { WorkloadCell, WorkloadReport } from './api';
import { workloadCsv } from './exportCsv';

const cell = (weekStart: string, extra: Partial<WorkloadCell> = {}): WorkloadCell => ({
  weekStart,
  capacityHours: 40,
  assignedHours: 50,
  loggedHours: 0,
  workingDays: 5,
  offDays: 0,
  allocationPercent: 100,
  issueCount: 4,
  ratio: 1.25,
  overloaded: true,
  ...extra,
});

const report: WorkloadReport = {
  from: '2026-10-12',
  to: '2026-10-25',
  projectId: null,
  hoursPerDay: 8,
  weeks: [],
  rows: [
    {
      user: { id: 'u1', email: 'a@x.vn', displayName: 'Lê Cường', avatarUrl: null },
      weeks: [
        cell('2026-10-12'),
        cell('2026-10-19', {
          capacityHours: 0,
          assignedHours: 0,
          issueCount: 0,
          ratio: null,
          overloaded: false,
        }),
      ],
      totals: {
        capacityHours: 40,
        assignedHours: 50,
        loggedHours: 0,
        ratio: 1.25,
        overloaded: true,
      },
      usesDefaultCapacity: false,
    },
  ],
};

describe('workloadCsv', () => {
  it('mỗi dòng là một cặp (người, tuần); ratio null → rỗng; quá tải → Có/Không', () => {
    const lines = workloadCsv(report).replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe(
      'Người,Tuần bắt đầu,Năng lực (giờ),Được giao (giờ),Số việc,Tỷ lệ %,Quá tải',
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('Lê Cường,12/10/2026,40,50,4,125,Có');
    expect(lines[2]).toBe('Lê Cường,19/10/2026,0,0,0,,Không');
  });
});
