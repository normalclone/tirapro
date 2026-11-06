/** Thân `members` của POST /projects: mỗi người đã chọn nhận cùng một vai trò ban đầu. */
export function initialMembers(userIds: readonly string[], roleId: string) {
  return userIds.map((userId) => ({ userId, roleId }));
}

/**
 * Vai trò ban đầu mặc định: mẫu "Developer" nếu có (khớp trước đây), không thì mẫu đầu tiên; rỗng nếu chưa có mẫu nào.
 */
export function defaultInitialRoleId(templates: readonly { id: string; name: string }[]): string {
  const dev = templates.find((t) => /developer|lập trình/i.test(t.name));
  return (dev ?? templates[0])?.id ?? '';
}
