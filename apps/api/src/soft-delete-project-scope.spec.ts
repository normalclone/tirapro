import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Truy vấn tài nguyên theo dự án (`project: { workspaceId }`) ở các service này phải loại dự án đã xoá mềm
 * (`deletedAt: null`) — lớp phòng thủ thứ hai sau guard `viaProject` của RBAC.
 */
const FILES = [
  'modules/labels/labels.service.ts',
  'modules/components/components.service.ts',
  'modules/analytics/analytics.service.ts',
  'modules/ai/sprint-assistant.service.ts',
  'modules/sprints/sprints.service.ts',
  'modules/boards/boards.service.ts',
  'modules/comments/comments.service.ts', // 077: reaction đi qua requireComment (lọc deletedAt) — không tự dựng truy vấn theo dự án
];

describe('soft-delete — project scope phòng thủ', () => {
  it.each(FILES)('%s: không còn `project: { workspaceId }` thiếu deletedAt: null', (f) => {
    const src = readFileSync(join(__dirname, f), 'utf8');
    expect(src.match(/project:\s*\{\s*workspaceId\s*\}/g) ?? []).toEqual([]);
  });

  it('reaction (077): chỉ ghi/đọc qua bình luận chưa xoá mềm trong workspace (requireComment) — không có đường tắt theo commentId thô', () => {
    const src = readFileSync(join(__dirname, 'modules/comments/comments.service.ts'), 'utf8');
    const m = /async setReaction\([\s\S]*?\n  }\n/.exec(src);
    expect(m, 'không tìm thấy setReaction').not.toBeNull();
    const body = m![0];
    expect(body.indexOf('this.requireComment(')).toBeGreaterThan(-1);
    expect(body.indexOf('this.requireComment(')).toBeLessThan(body.indexOf('commentReaction.'));
    expect(src).toMatch(
      /where: \{ id: commentId, deletedAt: null, issue: \{ workspaceId, deletedAt: null \} \}/,
    );
    // `list` chỉ gom reaction của bình luận đã lọc deletedAt: null ở truy vấn trước đó
    expect(src).toMatch(/where: \{ issueId, deletedAt: null \}/);
  });
});
