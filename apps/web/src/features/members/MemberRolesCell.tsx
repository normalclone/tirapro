import { useId, useRef } from 'react';
import { useAuth } from '@/stores/auth';
import { ChevronDown } from 'lucide-react';
import type { MemberDto, RoleDto } from '@tirapro/types';
import { RoleBadge } from '@/components/ui/RoleBadge';
import { useConfirm } from '@/components/ui/useConfirm';
import { toast } from 'sonner';
import { EditRolesPopover } from './EditRolesPopover';
import { frozenAdminRoles } from './adminGrant';
import {
  adminRoleIds,
  isLastAdmin,
  lockedRoleReasons,
  manageRoleIds,
  planRoleChange,
  selfDemoteCopy,
} from './roleChange';
import { useInlineMemberRoles } from './useInlineMemberRoles';

const ROLE_HINT = 'Vai trò quyết định người này được xem và làm gì ở đây';

/**
 * Cột vai trò của hàng thành viên. Có quyền `member:manage`: cả cụm badge là MỘT nút mở popover đổi vai trò (lưu ngay,
 * Hoàn tác trong toast). Không có quyền: badge là chữ thường.
 * Tên nút = "Đổi vai trò của {tên}" (không lẫn chữ badge — badge được đọc như mô tả qua `aria-describedby`).
 */
export function MemberRolesCell({
  member,
  members,
  roles,
  canManage,
  isSelf,
}: {
  member: MemberDto;
  /** Cả danh sách (để biết người này có phải quản trị viên cuối cùng không). */
  members: MemberDto[];
  roles: RoleDto[];
  canManage: boolean;
  isSelf: boolean;
}) {
  const user = member.user;
  const canGrantAdmin = useAuth((s) => s.can('workspace:admin')); // P-C14: boolean (đã gồm admin hệ thống)
  const clusterId = useId();
  const confirm = useConfirm();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inline = useInlineMemberRoles(user.id, user.displayName, roles, {
    isSelf,
    focusTrigger: () => triggerRef.current?.focus(),
  });

  const badges =
    member.roles.length > 0 ? (
      member.roles.map((r) => <RoleBadge key={r.id} name={r.name} color={r.color} />)
    ) : (
      <span className="text-xs text-faint">Chưa có vai trò</span>
    );

  // Danh mục vai trò chưa tải: chưa biết vai trò nào là admin → chưa cho đổi (tránh bỏ qua chặn quản trị viên cuối cùng).
  if (!canManage || roles.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end" title={ROLE_HINT}>
        {badges}
      </div>
    );
  }

  const currentIds = member.roles.map((r) => r.id);
  const adminIds = adminRoleIds(roles);
  const lastAdmin = isLastAdmin(members, user.id, adminIds);

  async function onChange(next: string[]) {
    const plan = planRoleChange({
      prev: currentIds,
      next,
      adminIds,
      manageIds: manageRoleIds(roles),
      lastAdmin,
      isSelf,
    });
    if (plan.kind === 'noop') return;
    if (plan.kind === 'blocked') {
      toast.error(plan.reason);
      return;
    }
    if (plan.kind === 'confirm') {
      const ok = await confirm({ ...selfDemoteCopy(plan.reason), destructive: true });
      if (!ok) {
        triggerRef.current?.focus();
        return;
      }
    }
    void inline.change(currentIds, plan.next, { canUndo: plan.canUndo });
  }

  return (
    <div className="flex flex-wrap items-center sm:justify-end">
      <EditRolesPopover
        roles={roles}
        current={member.roles}
        title={`Vai trò của ${user.displayName}`}
        instant={{
          onChange: (next) => void onChange(next),
          locked: lockedRoleReasons(currentIds, adminIds, lastAdmin),
          frozen: frozenAdminRoles(canGrantAdmin, adminIds),
        }}
        trigger={
          <button
            ref={triggerRef}
            type="button"
            aria-label={`Đổi vai trò của ${user.displayName}`}
            aria-describedby={clusterId}
            title={`Đổi vai trò — ${ROLE_HINT}`}
            className="-mx-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] data-[state=open]:bg-surface-2 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
          >
            <span id={clusterId} className="flex flex-wrap items-center gap-1.5">
              {badges}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
          </button>
        }
      />
    </div>
  );
}
