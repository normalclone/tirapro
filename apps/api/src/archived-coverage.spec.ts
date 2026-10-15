import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const MODULES = join(__dirname, 'modules');
const GUARD =
  /assertProjectWritable|assertIssueWritable|assertNotArchived|assertProjectIdWritable|WRITABLE_PROJECT_FILTER/;

/**
 * Service KHÔNG ghi dữ liệu làm việc của dự án (hoặc chỉ ghi qua IssuesService/SprintsService đã có guard).
 * Thêm service mới: gắn guard HOẶC thêm vào đây kèm lý do.
 */
const EXEMPT: Record<string, string> = {
  'activity/activity.service.ts': 'chỉ đọc',
  'analytics/analytics.service.ts': 'chỉ đọc',
  'export/export.service.ts': 'chỉ đọc',
  'search/search.service.ts': 'chỉ đọc',
  'rbac/issue-ownership.service.ts': 'kiểm quyền',
  'rbac/rbac.service.ts': 'kiểm quyền',
  'realtime/presence.service.ts': 'trạng thái tạm thời',
  'saved-filters/saved-filters.service.ts': 'bộ lọc của người dùng, không thuộc dự án',
  'notifications/notifications.service.ts': 'thông báo của người dùng',
  'ai/ai.service.ts': 'ghi qua IssuesService (đã chặn)',
  'ai/ai-quota.service.ts': 'hạn mức workspace',
  'ai/assignee-suggest.service.ts': 'chỉ đọc',
  'ai/claude.service.ts': 'gọi LLM',
  'ai/sprint-assistant.service.ts': 'đề xuất, ghi qua SprintsService/IssuesService (đã chặn)',
  'admin/admin.service.ts': 'quản trị hệ thống',
  'admin/admin-overview.service.ts': 'quản trị hệ thống',
  'admin/admin-system.service.ts': 'quản trị hệ thống',
  'admin/admin-workspaces.service.ts': 'quản trị hệ thống',
  'api-keys/api-key.service.ts': 'khoá API cấp workspace',
  'auth/auth.service.ts': 'định danh',
  'auth/invite.service.ts': 'định danh',
  'auth/password-reset.service.ts': 'định danh',
  'auth/token.service.ts': 'định danh',
  'automation/rule-engine.service.ts': 'thực thi qua IssuesService (lỗi archived vào nhật ký chạy)',
  'clients/clients.service.ts': 'cấp workspace',
  'programs/programs.service.ts': 'cấp workspace',
  'resources/resources.service.ts': 'cấp workspace',
  'teams/teams.service.ts': 'cấp workspace',
  'roles/roles.service.ts': 'phân quyền',
  'members/members.service.ts': 'phân quyền truy cập (quản trị cần chỉnh khi lưu trữ)',
  'config-catalog/config-catalog.service.ts': 'danh mục cấp workspace',
  'workflow-admin/workflow-admin.service.ts': 'workflow dùng chung workspace',
  'guides/guides.service.ts': 'hướng dẫn workspace',
  'system-settings/system-settings.service.ts': 'cấu hình hệ thống',
  'integrations/integrations.service.ts': 'hạ tầng tích hợp cấp workspace',
  'integrations/telegram.service.ts': 'gửi tin',
  'digests/digests.service.ts': 'hạ tầng báo cáo định kỳ cấp workspace',
  'import/jira/jira-import.service.ts': 'tạo dự án mới; ghi issue qua IssuesService',
  'mail/mail-outbox.service.ts': 'hàng đợi thư',
  'mail/mail.service.ts': 'gửi thư',
  'media/media.service.ts': 'lưu tệp',
  'users/users.service.ts': 'tài khoản',
  'workspaces/workspaces.service.ts': 'workspace',
  'workspaces/workspace-bootstrap.service.ts': 'khởi tạo workspace',
};

function services(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return services(p);
    return n.endsWith('.service.ts') ? [p] : [];
  });
}
const rel = (p: string) => relative(MODULES, p).split('\\').join('/');

describe('archived-coverage — dự án lưu trữ là chỉ đọc', () => {
  const files = services(MODULES);
  it('mọi *.service.ts hoặc có guard dự án lưu trữ hoặc nằm trong EXEMPT kèm lý do', () => {
    const missing = files
      .filter((f) => !GUARD.test(readFileSync(f, 'utf8')) && !(rel(f) in EXEMPT))
      .map(rel);
    expect(missing).toEqual([]);
  });
  it('EXEMPT không chứa service đã có guard hoặc không còn tồn tại (giữ danh sách sạch)', () => {
    const stale = Object.keys(EXEMPT).filter((k) => {
      const f = files.find((x) => rel(x) === k);
      return !f || GUARD.test(readFileSync(f, 'utf8'));
    });
    expect(stale).toEqual([]);
  });
});
