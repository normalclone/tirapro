import { useMemo, useState } from 'react';
import { SYSTEM_ROLES } from '@tirapro/types';
import { useRoles } from '@/features/roles/api';
import { useAuth } from '@/stores/auth';
import { frozenAdminRoles } from './adminGrant';
import { adminRoleIds } from './roleChange';

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
  // P-C14: người không phải quản trị không gán được vai trò mang `workspace:admin` (máy chủ trả 403).
  const canGrantAdmin = useAuth((s) => s.can('workspace:admin'));
  const frozen = useMemo(
    () => frozenAdminRoles(canGrantAdmin, adminRoleIds(wsRoles ?? [])),
    [canGrantAdmin, wsRoles],
  );
  return { roleOptions, effectiveRoleIds, setRoleIds, resetRoles: () => setRoleIds([]), frozen };
}
