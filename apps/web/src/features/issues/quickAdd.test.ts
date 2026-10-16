import { describe, expect, it } from 'vitest';
import type { TokenCtx } from './titleTokens';
import { buildQuickAddInput, pickDefaultType } from './quickAdd';

const ctx: TokenCtx = {
  priorities: [
    { id: 'p5', name: 'Highest', rank: 5 },
    { id: 'p4', name: 'High', rank: 4 },
    { id: 'p3', name: 'Medium', rank: 3, isDefault: true },
    { id: 'p2', name: 'Low', rank: 2 },
    { id: 'p1', name: 'Lowest', rank: 1 },
  ],
  users: [{ id: 'u1', displayName: 'Bình' }],
  sprints: [{ id: 's9', name: 'Sprint 9', state: 'FUTURE' }],
};
const d = { projectId: 'pr', typeId: 'ty', extra: { sprintId: 's1', statusId: 'st' } };

describe('buildQuickAddInput', () => {
  it('không token: giữ nguyên tiêu đề, trộn extra', () => {
    const r = buildQuickAddInput('Đăng ký bằng email', ctx, d)!;
    expect(r.input).toMatchObject({
      projectId: 'pr',
      typeId: 'ty',
      summary: 'Đăng ký bằng email',
      descriptionFormat: 'MARKDOWN',
      sprintId: 's1',
      statusId: 'st',
    });
    expect(r.unmatched).toEqual([]);
  });
  it('token ưu tiên/điểm/người/hạn được tách khỏi tiêu đề và gửi thành trường', () => {
    const r = buildQuickAddInput('Đăng ký !cao ~5 @Bình ^15/8/2027', ctx, d)!;
    expect(r.input).toMatchObject({
      summary: 'Đăng ký',
      priorityId: 'p4',
      storyPoints: 5,
      assigneeId: 'u1',
    });
    expect(new Date(r.input.dueDate!).getDate()).toBe(15);
  });
  it('#sprint ghi đè extra.sprintId', () =>
    expect(buildQuickAddInput('A #Sprint 9', ctx, d)!.input.sprintId).toBe('s9'));
  it('token không khớp: giữ trong tiêu đề và trả về để báo', () => {
    const r = buildQuickAddInput('A !xyz', ctx, d)!;
    expect(r.input.summary).toBe('A !xyz');
    expect(r.unmatched).toEqual(['!xyz']);
  });
  it('chỉ có token (tiêu đề rỗng) => null', () =>
    expect(buildQuickAddInput('!cao ~5', ctx, d)).toBeNull());
});

describe('pickDefaultType', () => {
  const types = [
    { id: 'sub', key: 'SUBTASK', isSubtask: true },
    { id: 'st', key: 'STORY', isSubtask: false },
    { id: 'bug', key: 'BUG', isSubtask: false },
  ];
  it('mặc định loại đầu không phải sub-task', () =>
    expect(pickDefaultType(types, null)).toBe('st'));
  it('theo khoá đã lưu nếu còn hợp lệ', () => expect(pickDefaultType(types, 'BUG')).toBe('bug'));
  it('khoá đã lưu là sub-task hoặc không còn => mặc định', () => {
    expect(pickDefaultType(types, 'SUBTASK')).toBe('st');
    expect(pickDefaultType(types, 'GONE')).toBe('st');
  });
  it('chỉ có sub-task => loại đầu', () => expect(pickDefaultType([types[0]!], null)).toBe('sub'));
});
