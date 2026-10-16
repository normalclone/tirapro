import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Chống rò rỉ dự án riêng tư — kiểm TĨNH. Mỗi service/gateway đọc DỮ LIỆU CHÉO DỰ ÁN phải dùng quyết định chung
 * (`ProjectAccessService`: visibleWhere / visibleProjectIds / canSee / assertCanSee) hoặc được liệt kê kèm lý do.
 * Thêm service đọc chéo dự án mới ⇒ thêm vào `MUST_USE_ACCESS` (và viết test "người ngoài không thấy" + "thành viên thấy").
 */
const MUST_USE_ACCESS = [
  'issues/issues.service.ts',
  'search/search.service.ts',
  'projects/projects.service.ts',
  'analytics/analytics.service.ts',
  'programs/programs.service.ts',
  'resources/resources.service.ts',
  'goals/goals.service.ts',
  'raid/raid.service.ts',
  'wiki/wiki.service.ts',
  'digests/digests.service.ts',
  'triage/triage.service.ts',
  'sla/sla.service.ts',
  'clients/clients.service.ts',
  'workflow-admin/workflow-admin.service.ts',
  'notifications/notifications.service.ts',
  'realtime/realtime.gateway.ts',
  'saved-filters/saved-filters.service.ts',
  'dev-links/dev-links.service.ts',
  'custom-fields/custom-fields.service.ts',
  'teams/teams.service.ts',
];

/** Điểm vào đọc chéo dự án của controller phải truyền người xem (`user.id`) xuống service — quên truyền = lỗi biên dịch/test. */
const CONTROLLER_PASSES_VIEWER: [string, RegExp][] = [
  ['issues/issues.controller.ts', /this\.issues\.list\([\s\S]*?user\.id\s*,?\s*\)/],
  ['issues/issues.controller.ts', /this\.issues\.getByKey\([^;]*user\.id/],
  ['wiki/wiki.controller.ts', /this\.wiki\.tree\([^)]*user\)/],
  ['wiki/wiki.controller.ts', /this\.wiki\.search\([^)]*user\)/],
  ['triage/triage.controller.ts', /this\.triage\.inbox\([\s\S]*?user\.id/],
  ['triage/triage.controller.ts', /this\.triage\.count\([^)]*user\.id/],
  ['sla/sla.controller.ts', /this\.sla\.board\([^)]*user\.id/],
  ['sla/sla.controller.ts', /this\.sla\.list\([^)]*user\.id/],
  ['digests/digests.controller.ts', /this\.digests\.list\([^)]*user\.id/],
  [
    'workflow-admin/workflow-admin.controller.ts',
    /this\.workflows\.listWorkflows\([\s\S]*?user\.id/,
  ],
  ['workflow-admin/workflow-admin.controller.ts', /this\.workflows\.getWorkflow\([^)]*user\.id/],
  ['dev-links/dev-links.controller.ts', /this\.devLinks\.listRepositories\([^)]*user\.id/],
  [
    'custom-fields/custom-fields.controller.ts',
    /this\.customFields\.listDefinitions\([^)]*user\.id/,
  ],
  ['clients/clients.controller.ts', /this\.clients\.list\([^)]*user\.id/],
];

const read = (f: string): string => readFileSync(join(__dirname, 'modules', f), 'utf8');

describe('dự án riêng tư — phủ đường đọc chéo dự án', () => {
  it.each(MUST_USE_ACCESS)('%s dùng ProjectAccessService', (f) => {
    expect(read(f)).toMatch(
      /ProjectAccessService|visibleWhere|visibleProjectIds|assertCanSee|canSee/,
    );
  });

  it.each(CONTROLLER_PASSES_VIEWER)('%s truyền người xem: %s', (f, re) => {
    expect(read(f)).toMatch(re);
  });

  it('không service nào tự tính "thấy dự án" bằng project:view cấp workspace (một hàm quyết định duy nhất)', () => {
    // wiki từng tự đi hỏi getEffectivePermissions(project:view) từng dự án; nay phải qua ProjectAccessService.
    expect(read('wiki/wiki.service.ts')).not.toMatch(/getEffectivePermissions/);
  });
});
