import { describe, expect, it } from 'vitest';
import { templateOptions } from './templateOptions';

describe('templateOptions', () => {
  it('3 mẫu theo thứ tự scrum, kanban, requirements; mỗi mẫu có các bước quy trình', () => {
    const opts = templateOptions();
    expect(opts.map((o) => o.key)).toEqual(['scrum', 'kanban', 'requirements']);
    expect(opts[0]!.steps).toEqual(['To Do', 'In Progress', 'In Review', 'Done']);
    expect(opts[1]!.steps).toEqual(['To Do', 'In Progress', 'Done']);
    expect(opts[2]!.steps).toEqual([
      'Đề xuất',
      'Đang phân tích',
      'Chờ duyệt',
      'Đã duyệt',
      'Đã bàn giao',
      'Từ chối',
    ]);
  });
  it('loại bảng của mẫu yêu cầu là KANBAN', () => {
    expect(templateOptions().find((o) => o.key === 'requirements')!.projectType).toBe('KANBAN');
  });
});
