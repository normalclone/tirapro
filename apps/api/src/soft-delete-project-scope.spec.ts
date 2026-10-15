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
];

describe('soft-delete — project scope phòng thủ', () => {
  it.each(FILES)('%s: không còn `project: { workspaceId }` thiếu deletedAt: null', (f) => {
    const src = readFileSync(join(__dirname, f), 'utf8');
    expect(src.match(/project:\s*\{\s*workspaceId\s*\}/g) ?? []).toEqual([]);
  });
});
