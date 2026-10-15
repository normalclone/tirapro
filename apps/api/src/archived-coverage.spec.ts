import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const MODULES = join(__dirname, 'modules');
const GUARD =
  /assertProjectWritable|assertIssueWritable|assertNotArchived|assertProjectIdWritable|WRITABLE_PROJECT_FILTER/;
/** Lời gọi ghi Prisma (`this.prisma.x.create(`, `tx.x.updateMany(`…). */
const WRITE = /\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(/;

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

/**
 * Phương thức GHI nhưng cố ý không chặn khi dự án lưu trữ: khoá `<file>#<method>` → lý do.
 * (Spec kiểm theo PHƯƠNG THỨC: file có một guard ở chỗ khác vẫn không che được phương thức ghi thiếu guard.)
 */
const EXEMPT_METHODS: Record<string, string> = {
  'projects/projects.service.ts#create': 'tạo dự án mới (chưa có dự án để lưu trữ)',
  'projects/projects.service.ts#archive': 'vòng đời dự án',
  'projects/projects.service.ts#unarchive': 'vòng đời dự án — chính là lối khôi phục',
  'projects/projects.service.ts#remove': 'vòng đời dự án (xoá mềm)',
  'automation/automation.service.ts#runDueRecurring':
    'cron; scanDueRecurring lọc `project: { archivedAt: null }` ở where',
  'automation/rules.service.ts#invalidate': 'xoá cache quy tắc, không ghi dữ liệu làm việc',
  'dev-links/dev-links.service.ts#createRepository':
    'kho mã nguồn là hạ tầng tích hợp cấp workspace',
  'dev-links/dev-links.service.ts#removeRepository':
    'kho mã nguồn là hạ tầng tích hợp cấp workspace',
  'issues/rank.service.ts#resolveRank':
    'chỉ đánh lại rank khi hết chỗ chèn; mọi caller (IssuesService.createCore/move) đã chặn dự án lưu trữ trước khi gọi',
  'import/import.service.ts#resolveOrCreateLabel':
    'helper nội bộ của luồng import (đã chặn trước khi tạo ImportJob)',
  'sla/sla.service.ts#onIssueCreated': 'phản ứng sự kiện issue (ghi issue đã bị chặn ở nguồn)',
  'sla/sla.service.ts#onCommentAdded': 'phản ứng sự kiện issue (ghi comment đã bị chặn ở nguồn)',
  'sla/sla.service.ts#onIssueTransitioned':
    'phản ứng sự kiện issue (chuyển trạng thái đã bị chặn ở nguồn)',
  'sprints/sprints.service.ts#snapshot':
    'số liệu báo cáo dẫn xuất; START/CLOSE đã chặn ở caller, cron DAILY chỉ chụp thêm điểm phẳng',
  'watchers/watchers.service.ts#onIssueUpdated':
    'phản ứng sự kiện issue (ghi issue đã bị chặn ở nguồn)',
  'watchers/watchers.service.ts#onIssueTransitioned':
    'phản ứng sự kiện issue (ghi issue đã bị chặn ở nguồn)',
  'watchers/watchers.service.ts#onCommentAdded':
    'phản ứng sự kiện issue (ghi comment đã bị chặn ở nguồn)',
};

interface Method {
  name: string;
  body: string;
}

/** Tách các phương thức cấp class theo dòng bắt đầu bằng đúng 2 dấu cách (parser thô, đủ cho code của repo). */
export function parseMethods(source: string): Method[] {
  const lines = source.split('\n');
  const starts: { name: string; line: number }[] = [];
  lines.forEach((l, i) => {
    const m =
      /^ {2}(?:(?:public|private|protected|static|async)\s+)*(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(/.exec(
        l,
      );
    if (m && !['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(m[1]!))
      starts.push({ name: m[1]!, line: i });
  });
  return starts.map((s, idx) => ({
    name: s.name,
    body: lines.slice(s.line, starts[idx + 1]?.line ?? lines.length).join('\n'),
  }));
}

/** Phương thức `name` hoặc helper cùng file mà nó gọi (đệ quy) thoả `re`. */
function reaches(methods: Method[], name: string, re: RegExp, seen = new Set<string>()): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  const m = methods.find((x) => x.name === name);
  if (!m) return false;
  if (re.test(m.body)) return true;
  const calls = [...m.body.matchAll(/this\.([A-Za-z_$][\w$]*)\(/g)].map((x) => x[1]!);
  return calls.some((c) => reaches(methods, c, re, seen));
}

/** Phương thức public có ghi Prisma (trực tiếp hoặc qua helper cùng file) mà không có guard ở đâu trên đường đó. */
export function unguardedWriteMethods(source: string): string[] {
  const methods = parseMethods(source);
  return methods
    .filter((m) => !/^ {2}(?:private|protected)\s/m.test(m.body.split('\n')[0]!))
    .filter((m) => reaches(methods, m.name, WRITE) && !reaches(methods, m.name, GUARD))
    .map((m) => m.name);
}

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

  it('mọi phương thức ghi của service (không miễn trừ) có guard dự án lưu trữ hoặc nằm trong EXEMPT_METHODS', () => {
    const missing = files
      .filter((f) => !(rel(f) in EXEMPT))
      .flatMap((f) =>
        unguardedWriteMethods(readFileSync(f, 'utf8'))
          .map((m) => `${rel(f)}#${m}`)
          .filter((k) => !(k in EXEMPT_METHODS)),
      );
    expect(missing).toEqual([]);
  });

  it('EXEMPT không chứa service đã có guard hoặc không còn tồn tại (giữ danh sách sạch)', () => {
    const stale = Object.keys(EXEMPT).filter((k) => {
      const f = files.find((x) => rel(x) === k);
      return !f || GUARD.test(readFileSync(f, 'utf8'));
    });
    expect(stale).toEqual([]);
  });

  it('EXEMPT_METHODS không chứa phương thức đã có guard hoặc không còn là phương thức ghi', () => {
    const stale = Object.keys(EXEMPT_METHODS).filter((k) => {
      const [file, name] = k.split('#') as [string, string];
      const f = files.find((x) => rel(x) === file);
      return !f || !unguardedWriteMethods(readFileSync(f, 'utf8')).includes(name);
    });
    expect(stale).toEqual([]);
  });

  it('tự kiểm: bắt phương thức ghi thiếu guard, kể cả khi file có guard ở phương thức khác', () => {
    const fake = `
@Injectable()
export class FakeService {
  async safe(id: string) {
    await assertProjectWritable(this.prisma, id);
    await this.prisma.thing.create({ data: {} });
  }

  async viaHelper(id: string) {
    await this.requireWritable(id);
    await this.prisma.thing.update({ where: { id }, data: {} });
  }

  async unsafe(id: string) {
    await this.prisma.thing.delete({ where: { id } });
  }

  async unsafeViaHelper(id: string) {
    await this.write(id);
  }

  async list() {
    return this.prisma.thing.findMany();
  }

  private async write(id: string) {
    await this.prisma.thing.updateMany({ where: { id }, data: {} });
  }

  private async requireWritable(id: string) {
    await assertProjectIdWritable(this.prisma, id);
  }
}`;
    expect(unguardedWriteMethods(fake).sort()).toEqual(['unsafe', 'unsafeViaHelper']);
  });
});
