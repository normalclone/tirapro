import { useMemo, useState } from 'react';
import { SYSTEM_ROLES } from '@tirapro/types';
import { useRoles } from '@/features/roles/api';

/**
 * Chọn vai trò WORKSPACE khi thêm người: danh sách lựa chọn + vai trò mặc định "Thành viên" khi chưa chọn gì.
 * Dùng chung cho "chọn người có sẵn" và "tạo tài khoản mới".
 */
export function useWorkspaceRoleChoice() {
  const { data: wsRoles } = useRoles('WORKSPACE');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const roleOptions = useMemo(
    () => (wsRoles ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color })),
    [wsRoles],
  );
  const defaultRoleIds = useMemo(() => {
    const member = (wsRoles ?? []).find((r) => r.name === SYSTEM_ROLES.WORKSPACE_MEMBER);
    return member ? [member.id] : [];
  }, [wsRoles]);
  const effectiveRoleIds = roleIds.length > 0 ? roleIds : defaultRoleIds;
  return { roleOptions, effectiveRoleIds, setRoleIds, resetRoles: () => setRoleIds([]) };
}
