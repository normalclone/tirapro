import { describe, expect, it } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import { sprintCsvFilename, sprintIssuesCsv } from './exportCsv';

const issue = (over: Partial<IssueDto>): IssueDto =>
  ({
    key: 'DEMO-1',
    summary: 'Đăng nhập',
    type: { name: 'Story' },
    status: { name: 'Done' },
    priority: { name: 'High' },
    assignee: { displayName: 'An' },
    storyPoints: 3,
    dueDate: '2026-10-29T00:00:00.000Z',
    ...over,
  }) as IssueDto;

describe('sprintIssuesCsv', () => {
  it('một dòng/việc, ngày theo dd/MM/yyyy (ngày lịch, không lệch múi giờ)', () => {
    const lines = sprintIssuesCsv([issue({})])
      .replace('﻿', '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toBe('Mã,Tóm tắt,Loại,Trạng thái,Ưu tiên,Người phụ trách,Điểm,Hạn');
    expect(lines[1]).toBe('DEMO-1,Đăng nhập,Story,Done,High,An,3,29/10/2026');
  });

  it('thiếu giá trị → ô trống; tóm tắt bắt đầu bằng "=" bị vô hiệu công thức', () => {
    const csv = sprintIssuesCsv([
      issue({
        summary: '=1+1',
        priority: null,
        assignee: null,
        storyPoints: null,
        dueDate: null,
      }),
    ]);
    expect(csv).toContain("DEMO-1,'=1+1,Story,Done,,,,\r\n");
  });
});

describe('sprintCsvFilename', () => {
  it('gạch nối thay khoảng trắng/ký tự lạ, giữ chữ có dấu', () => {
    expect(sprintCsvFilename('DEMO', 'Sprint 2')).toBe('tirapro-DEMO-sprint-2.csv');
    expect(sprintCsvFilename('DEMO', 'Đợt "A"/B ')).toBe('tirapro-DEMO-đợt-a-b.csv');
    expect(sprintCsvFilename('DEMO', '///')).toBe('tirapro-DEMO-sprint.csv');
  });
});
