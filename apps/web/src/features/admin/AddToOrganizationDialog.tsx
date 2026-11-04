import { useMemo, useState, type ComponentProps, type FormEvent } from 'react';
import { Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { SYSTEM_ROLES } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { RoleMultiSelect } from '@/components/ui/RoleMultiSelect';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { apiErrorMessage } from '@/lib/api';
import { useOpenSession } from '@/lib/useOpenSession';
import { useRoles } from '@/features/roles/api';
import { useAddAdminUserToOrganization, useAdminOrganizations, type AdminUser } from './api';

/** Luôn mount (có hiệu ứng đóng); `key` theo lần mở → form khởi tạo lại mỗi lần mở. */
export function AddToOrganizationDialog(
  props: ComponentProps<typeof AddToOrganizationDialogInner>,
) {
  const session = useOpenSession(props.open);
  return <AddToOrganizationDialogInner key={session} {...props} />;
}

function AddToOrganizationDialogInner({
  user,
  open,
  onClose,
}: {
  user: AdminUser;
  open: boolean;
  onClose: () => void;
}) {
  const { data: organizations } = useAdminOrganizations();
  const { data: roles } = useRoles('ORGANIZATION');
  const add = useAddAdminUserToOrganization();
  const [organizationId, setOrganizationId] = useState('');
  const [picked, setPicked] = useState<string[] | null>(null);

  // Chỉ vai trò HỆ THỐNG: vai trò tuỳ biến thuộc tổ chức của admin đang xem, tổ chức đích sẽ từ chối.
  const roleOptions = useMemo(
    () =>
      (roles ?? [])
        .filter((r) => r.isSystem)
        .map((r) => ({ id: r.id, name: r.name, color: r.color })),
    [roles],
  );
  const defaultRoleIds = useMemo(() => {
    const member = roleOptions.find((r) => r.name === SYSTEM_ROLES.ORGANIZATION_MEMBER);
    return member ? [member.id] : [];
  }, [roleOptions]);
  const roleIds = picked ?? defaultRoleIds;

  const wsOptions = (organizations ?? [])
    .filter((w) => !w.archived)
    .map((w) => ({ value: w.id, label: w.name, hint: `${w.members} thành viên` }));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!organizationId || add.isPending) return;
    add.mutate(
      { userId: user.id, organizationId, roleIds: roleIds.length > 0 ? roleIds : undefined },
      {
        onSuccess: () => {
          toast.success(`Đã thêm ${user.displayName} vào tổ chức`);
          onClose();
        },
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      icon={<Building2 className="h-4 w-4" />}
      title="Thêm vào tổ chức"
      description={`${user.displayName} (${user.email})`}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="submit"
            form="add-to-organization-form"
            loading={add.isPending}
            disabled={!organizationId}
          >
            Thêm
          </Button>
        </>
      }
    >
      <form id="add-to-organization-form" onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink">Tổ chức</span>
          <SearchSelect
            value={organizationId}
            onChange={setOrganizationId}
            options={wsOptions}
            placeholder="Chọn tổ chức…"
            searchPlaceholder="Tìm tổ chức…"
            ariaLabel="Tổ chức"
            className="w-full"
          />
        </div>
        {roleOptions.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-ink">Vai trò</span>
            <RoleMultiSelect
              options={roleOptions}
              value={roleIds}
              onChange={setPicked}
              ariaLabel="Vai trò trong tổ chức"
            />
          </div>
        )}
      </form>
    </Dialog>
  );
}
