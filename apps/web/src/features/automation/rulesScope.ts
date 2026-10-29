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

/** Số dự án kiểm quyền `/permissions/me` mỗi đợt (tránh bắn một request cho MỌI dự án). */
export const RULES_CHECK_BATCH = 5;

/**
 * Dự án cần tra quyền lúc này: quản trị workspace → không cần (có quyền ở mọi dự án); còn lại → `limit` dự án đầu của
 * danh sách + dự án người dùng đã chọn. Tăng `limit` từng đợt (`shouldCheckMore`) cho tới khi gặp dự án có quyền.
 */
export function projectIdsToCheck(input: {
  projects: { id: string }[] | undefined;
  choice: string | null;
  canWorkspace: boolean;
  limit: number;
}): string[] {
  if (input.canWorkspace || !input.projects) return [];
  const ids = input.projects.slice(0, input.limit).map((p) => p.id);
  if (input.choice && input.choice !== ALL_RULES && !ids.includes(input.choice))
    ids.push(input.choice);
  return ids;
}

/** Đợt hiện tại đã tra xong hết mà chưa có dự án nào có quyền, còn dự án chưa tra → tra tiếp đợt sau. */
export function shouldCheckMore(input: {
  projects: { id: string }[] | undefined;
  choice: string | null;
  canWorkspace: boolean;
  limit: number;
  projectCan: ScopeCan;
}): boolean {
  const { projects, choice, canWorkspace, limit, projectCan } = input;
  if (canWorkspace || choice || !projects || limit >= projects.length) return false;
  const checked = projects.slice(0, limit);
  return checked.every((p) => projectCan(p.id) === false);
}

/**
 * Giới hạn tra quyền KẾ TIẾP: tăng một đợt nếu còn cần (`shouldCheckMore`), không thì giữ nguyên. Gọi lại mỗi lần
 * `limit` đổi (kể cả khi đợt kế đã có sẵn trong cache và `shouldCheckMore` vẫn `true`) để vòng tăng luôn chạy tới khi
 * gặp dự án có quyền hoặc hết danh sách.
 */
export function nextCheckLimit(input: Parameters<typeof shouldCheckMore>[0]): number {
  return shouldCheckMore(input) ? input.limit + RULES_CHECK_BATCH : input.limit;
}
