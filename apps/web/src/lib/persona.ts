import { PERMISSIONS, SYSTEM_ROLES, type PermissionKey } from '@tirapro/types';

/** Ba "vai" người dùng ở trang chủ: người làm (dev), người kiểm thử (tester), người viết yêu cầu (BA/PO/SM). */
export type Persona = 'dev' | 'tester' | 'ba';

const TESTER_ROLES: ReadonlySet<string> = new Set([SYSTEM_ROLES.TESTER, SYSTEM_ROLES.REVIEWER]);
const BA_ROLES: ReadonlySet<string> = new Set([
  SYSTEM_ROLES.BUSINESS_ANALYST,
  SYSTEM_ROLES.PRODUCT_OWNER,
  SYSTEM_ROLES.SCRUM_MASTER,
]);
/** Vai trò làm việc trực tiếp — có vai này thì khỏi suy luận theo quyền. */
const DEV_ROLES: ReadonlySet<string> = new Set([
  SYSTEM_ROLES.DEVELOPER,
  SYSTEM_ROLES.DEVOPS,
  SYSTEM_ROLES.DESIGNER,
  SYSTEM_ROLES.PROJECT_DEVELOPER,
]);

/**
 * Suy vai từ vai trò (ưu tiên tester > ba > dev). Không có vai trò dự án nhận diện được (chỉ vai trò mặc định của
 * workspace) → suy theo quyền: có `issue:triage` mà không có `issue:assign` ⇒ tester; có `sprint:manage` ⇒ ba; còn lại dev.
 */
export function personaOf(
  memberships: { roles: { name: string }[] }[],
  can: (p: PermissionKey) => boolean,
): Persona {
  const names = new Set(memberships.flatMap((m) => m.roles.map((r) => r.name)));
  const has = (set: ReadonlySet<string>) => [...names].some((n) => set.has(n));
  if (has(TESTER_ROLES)) return 'tester';
  if (has(BA_ROLES)) return 'ba';
  if (has(DEV_ROLES)) return 'dev';
  if (can(PERMISSIONS.ISSUE_TRIAGE) && !can(PERMISSIONS.ISSUE_ASSIGN)) return 'tester';
  if (can(PERMISSIONS.SPRINT_MANAGE)) return 'ba';
  return 'dev';
}

export interface HomeAction {
  id: string;
  label: string;
  kind: 'link' | 'create-issue' | 'report-bug' | 'create-project';
  to?: string;
  primary?: boolean;
}

/**
 * Nội dung trạng thái rỗng của "Việc của tôi": nút hành động ĐÚNG VAI thay cho câu "Bạn chưa được giao việc nào".
 * Chưa có dự án nào: giải thích; nút Tạo dự án chỉ khi được phép.
 */
export function emptyHomeActions(
  persona: Persona,
  ctx: { projectKey: string | null; canCreateProject: boolean },
): { title: string; description: string; actions: HomeAction[] } {
  if (!ctx.projectKey) {
    return {
      title: 'Bạn chưa thuộc dự án nào',
      description: 'Nhờ quản trị viên thêm bạn vào một dự án.',
      actions: ctx.canCreateProject
        ? [{ id: 'create-project', label: 'Tạo dự án', kind: 'create-project', primary: true }]
        : [],
    };
  }
  switch (persona) {
    case 'tester':
      return {
        title: 'Chưa có việc nào cần bạn kiểm thử',
        description: 'Phát hiện lỗi? Báo ngay để nhóm xử lý.',
        actions: [{ id: 'report-bug', label: 'Báo lỗi', kind: 'report-bug', primary: true }],
      };
    case 'ba':
      return {
        title: 'Bạn chưa có yêu cầu nào',
        description: 'Viết yêu cầu mới để đưa vào Việc chờ của dự án.',
        actions: [
          { id: 'create-issue', label: 'Viết yêu cầu mới', kind: 'create-issue', primary: true },
        ],
      };
    default:
      return {
        title: 'Bạn chưa được giao việc nào',
        description: 'Nhận một việc từ Việc chờ, hoặc nhờ người phụ trách giao cho bạn.',
        actions: [
          {
            id: 'open-backlog',
            label: 'Nhận việc từ Việc chờ',
            kind: 'link',
            to: `/p/${ctx.projectKey}/backlog`,
            primary: true,
          },
        ],
      };
  }
}
