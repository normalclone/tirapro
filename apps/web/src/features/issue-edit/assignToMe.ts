import type { IssueDto, UserDto, UserRefDto } from '@tirapro/types';

export const ASSIGNED_TO_ME_TOAST = 'Đã gán cho bạn';

/** Người dùng hiện tại → tham chiếu người (như `issue.assignee`) cho vá lạc quan. */
function toUserRef(me: UserDto): UserRefDto {
  const { isSystemAdmin: _a, lastSeenAt: _b, canCreateWorkspace: _c, ...ref } = me;
  return ref;
}

/**
 * Biến số cho `useUpdateIssue().mutate` của "Gán cho tôi": cùng đường sửa issue với ô chọn người phụ trách (kèm `version` →
 * OCC) và vá lạc quan cả `assignee` (tên + ảnh đổi tức thì), bản thật của máy chủ thay thế khi về.
 */
export function assignToMeVars(issue: Pick<IssueDto, 'id' | 'key' | 'version'>, me: UserDto) {
  return {
    id: issue.id,
    key: issue.key,
    patch: { assigneeId: me.id },
    version: issue.version,
    optimistic: { assignee: toUserRef(me) },
  };
}
