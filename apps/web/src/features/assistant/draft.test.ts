import { describe, expect, it } from 'vitest';
import { buildDraft, pickType } from './draft';
import { META, PROJ, SPRINTS, USERS } from './fixtures';

const build = (text: string, typeHint: Parameters<typeof buildDraft>[0]['typeHint'] = null) =>
  buildDraft({ text, typeHint, project: PROJ, meta: META, users: USERS, sprints: SPRINTS });

describe('thẻ nháp từ token', () => {
  it('ví dụ brief: tiêu đề + ưu tiên + người + hạn + sprint + điểm', () => {
    const d = build('Sửa lỗi login !high @an ^mai #sprint7 ~3')!;
    expect(d.summary).toBe('Sửa lỗi login');
    expect(d.priority).toEqual({ id: 'pr-high', name: 'High' });
    expect(d.assignee).toEqual({ id: 'u-an', name: 'An Nguyễn' });
    expect(d.sprint?.name).toBe('Sprint 7');
    expect(d.points).toBe(3);
    expect(d.due).toBeTruthy();
    expect(d.unmatched).toEqual([]);
    expect(d.projectKey).toBe('DEMO');
    expect(d.typeName).toBe('Task');
  });
  it('payload gửi đi khớp thẻ: đúng project, loại, tiêu đề (bỏ token), markdown', () => {
    const d = build('Viết test !high @binh ~5')!;
    expect(d.input).toMatchObject({
      projectId: 'p1',
      typeId: 't-task',
      summary: 'Viết test',
      descriptionFormat: 'MARKDOWN',
      priorityId: 'pr-high',
      assigneeId: 'u-binh',
      storyPoints: 5,
    });
    expect(d.input.dueDate).toBeUndefined();
  });
  it('token không khớp: cảnh báo kèm gợi ý, token vẫn nằm trong tiêu đề', () => {
    const d = build('Dọn kho @khongco !sieucap')!;
    expect(d.unmatched).toEqual(['@khongco', '!sieucap']);
    expect(d.unmatchedHint).toContain('gõ @ để chọn người');
    expect(d.unmatchedHint).toContain('gõ ! để chọn mức ưu tiên');
    expect(d.summary).toContain('@khongco');
    expect(d.assignee).toBeUndefined();
  });
  it('gõ không dấu vẫn khớp người', () => {
    expect(build('X @Binh')!.assignee?.name).toBe('Bình Trần');
  });
  it('tiêu đề rỗng sau khi bỏ token → không dựng thẻ', () => {
    expect(build('!high @an')).toBeNull();
    expect(build('   ')).toBeNull();
  });
  it('rawText giữ nguyên chữ gõ (để mở form đầy đủ điền sẵn)', () => {
    expect(build('  Làm báo cáo !high ^t6 ')!.rawText).toBe('Làm báo cáo !high ^t6');
  });
});

describe('chọn loại việc', () => {
  it('mặc định: Task; bug/story/epic theo gợi ý', () => {
    expect(pickType(META.issueTypes, null).id).toBe('t-task');
    expect(pickType(META.issueTypes, 'bug').id).toBe('t-bug');
    expect(pickType(META.issueTypes, 'story').id).toBe('t-story');
    expect(pickType(META.issueTypes, 'epic').id).toBe('t-epic');
  });
  it('dự án thiếu loại được gợi ý → loại mặc định kèm câu báo', () => {
    const noBug = META.issueTypes.filter((t) => t.key !== 'BUG');
    const r = pickType(noBug, 'bug');
    expect(r.id).toBe('t-task');
    expect(r.note).toContain('chưa có loại Bug');
    const d = buildDraft({
      text: 'Lỗi',
      typeHint: 'bug',
      project: PROJ,
      meta: { ...META, issueTypes: noBug },
      users: USERS,
      sprints: SPRINTS,
    })!;
    expect(d.typeNote).toContain('Bug');
  });
  it('không bao giờ chọn loại sub-task', () => {
    expect(
      pickType(
        [
          { id: 'sub', name: 'Sub', key: 'SUBTASK', isSubtask: true },
          ...META.issueTypes.slice(0, 1),
        ],
        null,
      ).id,
    ).toBe('t-task');
  });
  it('thêm bug → thẻ loại Bug', () => {
    expect(build('Nút lưu hỏng', 'bug')!.typeName).toBe('Bug');
  });
  it('epic: bỏ epicId khỏi payload (epic là cấp cao nhất)', () => {
    expect(build('Thanh toán', 'epic')!.input.epicId).toBeUndefined();
  });
});
