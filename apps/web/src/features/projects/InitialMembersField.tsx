import { useMemo, useState } from 'react';
import { RoleMultiSelect } from '@/components/ui/RoleMultiSelect';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { useAuth } from '@/stores/auth';
import { useRoles } from '@/features/roles/api';
import { adminRoleIds } from '@/features/members/roleChange';
import { useUserSelect } from '@/features/members/useUserSelect';
import { defaultInitialRoleId } from './initialMembers';

/** Trạng thái ô "Thêm người vào dự án" của hộp Tạo dự án: người đã chọn + vai trò ban đầu chung cho họ. */
export function useInitialMembers(open: boolean) {
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [pickedRoleId, setRoleId] = useState('');
  const picker = useUserSelect({ enabled: open });
  const { data: templates } = useRoles('PROJECT');
  const canGrantAdmin = useAuth((s) => s.can('organization:admin'));
  // Vai trò ban đầu = MẪU cấp dự án (dự án mới chưa có vai trò riêng); mẫu mang quyền quản trị chỉ Quản trị mới chọn.
  const roleChoices = useMemo(() => {
    const locked = canGrantAdmin ? new Set<string>() : new Set(adminRoleIds(templates ?? []));
    return (templates ?? []).filter((t) => !locked.has(t.id));
  }, [templates, canGrantAdmin]);
  const roleId = pickedRoleId || defaultInitialRoleId(roleChoices);
  return { picker, memberIds, setMemberIds, roleChoices, roleId, setRoleId };
}

export function InitialMembersField({ state }: { state: ReturnType<typeof useInitialMembers> }) {
  const { picker, memberIds, setMemberIds, roleChoices, roleId, setRoleId } = state;
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-muted">
        Thêm người vào dự án <span className="font-normal text-faint">(tùy chọn)</span>
      </span>
      <RoleMultiSelect
        options={picker.roleOptions}
        onSearchChange={picker.onSearchChange}
        moreHint={picker.moreHint}
        resolveOption={picker.resolveRole}
        searchPlaceholder="Tìm thành viên…"
        value={memberIds}
        onChange={setMemberIds}
        requireOne={false}
        placeholder="Chọn người…"
        ariaLabel="Chọn người thêm vào dự án"
      />
      {memberIds.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <span className="shrink-0 text-sm text-muted">Vai trò ban đầu:</span>
          <SearchSelect
            value={roleId}
            onChange={setRoleId}
            options={roleChoices.map((r) => ({ value: r.id, label: r.name, color: r.color }))}
            placeholder="Chọn vai trò…"
            searchPlaceholder="Tìm vai trò…"
            ariaLabel="Vai trò ban đầu của người được thêm"
            className="min-w-0 flex-1 text-sm"
          />
        </div>
      )}
      <p className="mt-1.5 text-xs text-faint">
        Bạn tự là Quản trị dự án. Sau khi tạo có thể tạo vai trò riêng ở Cấu hình › Vai trò.
      </p>
    </div>
  );
}
