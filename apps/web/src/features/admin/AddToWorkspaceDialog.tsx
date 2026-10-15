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
import { useAddAdminUserToWorkspace, useAdminWorkspaces, type AdminUser } from './api';

/** Luôn mount (có hiệu ứng đóng); `key` theo lần mở → form khởi tạo lại mỗi lần mở. */
export function AddToWorkspaceDialog(props: ComponentProps<typeof AddToWorkspaceDialogInner>) {
  const session = useOpenSession(props.open);
  return <AddToWorkspaceDialogInner key={session} {...props} />;
}

function AddToWorkspaceDialogInner({
  user,
  open,
  onClose,
}: {
  user: AdminUser;
  open: boolean;
  onClose: () => void;
}) {
  const { data: workspaces } = useAdminWorkspaces();
  const { data: roles } = useRoles('WORKSPACE');
  const add = useAddAdminUserToWorkspace();
  const [workspaceId, setWorkspaceId] = useState('');
  const [picked, setPicked] = useState<string[] | null>(null);

  // Chỉ vai trò HỆ THỐNG: vai trò tuỳ biến thuộc workspace của admin đang xem, workspace đích sẽ từ chối.
  const roleOptions = useMemo(
    () =>
      (roles ?? [])
        .filter((r) => r.isSystem)
        .map((r) => ({ id: r.id, name: r.name, color: r.color })),
    [roles],
  );
  const defaultRoleIds = useMemo(() => {
    const member = roleOptions.find((r) => r.name === SYSTEM_ROLES.WORKSPACE_MEMBER);
    return member ? [member.id] : [];
  }, [roleOptions]);
  const roleIds = picked ?? defaultRoleIds;

  const wsOptions = (workspaces ?? [])
    .filter((w) => !w.archived)
    .map((w) => ({ value: w.id, label: w.name, hint: `${w.members} thành viên` }));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId || add.isPending) return;
    add.mutate(
      { userId: user.id, workspaceId, roleIds: roleIds.length > 0 ? roleIds : undefined },
      {
        onSuccess: () => {
          toast.success(`Đã thêm ${user.displayName} vào không gian làm việc`);
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
      title="Thêm vào không gian làm việc"
      description={`${user.displayName} (${user.email})`}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="submit"
            form="add-to-workspace-form"
            loading={add.isPending}
            disabled={!workspaceId}
          >
            Thêm
          </Button>
        </>
      }
    >
      <form id="add-to-workspace-form" onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink">Không gian làm việc</span>
          <SearchSelect
            value={workspaceId}
            onChange={setWorkspaceId}
            options={wsOptions}
            placeholder="Chọn không gian làm việc…"
            searchPlaceholder="Tìm không gian làm việc…"
            ariaLabel="Không gian làm việc"
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
              ariaLabel="Vai trò trong không gian làm việc"
            />
          </div>
        )}
      </form>
    </Dialog>
  );
}
