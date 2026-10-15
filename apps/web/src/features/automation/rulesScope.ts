import { ALL_RULES } from './rules-api';

/** Quyền `automation:manage` theo dự án: true/false, undefined = quyền đang tải. */
export type ScopeCan = (projectId: string) => boolean | undefined;

export interface RulesScope {
  /** Phạm vi đang chọn (ALL_RULES hoặc id dự án); undefined = chưa quyết được (đang tải quyền / chưa có dự án). */
  scope: string | undefined;
  /** Có `automation:manage` ở phạm vi này không; undefined = chưa biết (đang tải). */
  canManage: boolean | undefined;
}

/**
 * Phạm vi mặc định + quyền của trang Quy tắc:
 *  - người dùng đã chọn → giữ lựa chọn đó;
 *  - quản trị workspace → "Tất cả quy tắc";
 *  - còn lại → dự án ĐẦU TIÊN mà họ CÓ quyền (chưa biết hết quyền thì chờ nếu chưa thấy dự án nào có quyền);
 *  - không dự án nào có quyền → dự án đầu để trang giải thích thiếu quyền (không gọi API).
 * `canManage` quyết định có gọi `GET /automation/rules` hay không (false → không gọi, tránh 403 đỏ).
 */
export function resolveRulesScope(input: {
  choice: string | null;
  canWorkspace: boolean;
  projects: { id: string }[] | undefined;
  projectCan: ScopeCan;
}): RulesScope {
  const { choice, canWorkspace, projects, projectCan } = input;
  const canOf = (scope: string): boolean | undefined =>
    scope === ALL_RULES ? canWorkspace : canWorkspace ? true : projectCan(scope);
  if (choice) return { scope: choice, canManage: canOf(choice) };
  if (canWorkspace) return { scope: ALL_RULES, canManage: true };
  if (!projects) return { scope: undefined, canManage: undefined };
  const firstAllowed = projects.find((p) => projectCan(p.id) === true);
  if (firstAllowed) return { scope: firstAllowed.id, canManage: true };
  if (projects.some((p) => projectCan(p.id) === undefined))
    return { scope: undefined, canManage: undefined };
  const first = projects[0];
  return first ? { scope: first.id, canManage: false } : { scope: undefined, canManage: false };
}
