import { describe, expect, it } from 'vitest';
import { templateOptions } from './templateOptions';

describe('templateOptions', () => {
  it('5 mẫu theo thứ tự scrum, kanban, requirements, software, general; mỗi mẫu có các bước quy trình', () => {
    const opts = templateOptions();
    expect(opts.map((o) => o.key)).toEqual([
      'scrum',
      'kanban',
      'requirements',
      'software',
      'general',
    ]);
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
  it('mẫu software/general: các bước theo cột bảng (Xong gộp Hoàn thành + Không xử lý)', () => {
    const opts = templateOptions();
    expect(opts.find((o) => o.key === 'software')!.steps).toEqual([
      'Cần làm',
      'BA phân tích',
      'Sẵn sàng',
      'Đang làm',
      'Review code',
      'Chờ test',
      'Đang test',
      'Xong',
    ]);
    expect(opts.find((o) => o.key === 'general')!.steps).toEqual([
      'Cần làm',
      'Đang làm',
      'Chờ duyệt',
      'Xong',
    ]);
  });
  it('loại bảng của mẫu yêu cầu là KANBAN', () => {
    expect(templateOptions().find((o) => o.key === 'requirements')!.projectType).toBe('KANBAN');
  });
});
