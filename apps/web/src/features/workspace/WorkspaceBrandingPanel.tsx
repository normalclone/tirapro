import { Building2 } from 'lucide-react';
import { PERMISSIONS } from '@tirapro/types';
import { AvatarUploader } from '@/components/ui/AvatarUploader';
import { useAuth } from '@/stores/auth';
import { useMyWorkspaces, useUploadWorkspaceAvatar, useRemoveWorkspaceAvatar } from './api';
import { SETTINGS_LABELS } from '@/lib/navLabels';
import { SectionCard } from '@/components/ui/SectionCard';

/** Logo/ảnh của không gian làm việc đang hoạt động. Chỉ quản trị chung mới đổi được. */
export function WorkspaceBrandingPanel() {
  const activeId = useAuth((s) => s.workspaceId);
  const canAdmin = useAuth((s) => s.can(PERMISSIONS.WORKSPACE_ADMIN));
  const { data: workspaces = [] } = useMyWorkspaces();
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];

  const upload = useUploadWorkspaceAvatar(active?.id ?? '');
  const remove = useRemoveWorkspaceAvatar(active?.id ?? '');

  if (!active) return null;

  return (
    <SectionCard
      icon={<Building2 className="h-4 w-4" />}
      title={SETTINGS_LABELS.general}
      description={
        <>
          Logo hiện ở nút chuyển không gian làm việc trên thanh trên cùng.{' '}
          {!canAdmin && 'Chỉ quản trị viên mới đổi được.'}
        </>
      }
    >
      <AvatarUploader
        name={active.name}
        src={active.avatarUrl}
        shape="rounded"
        size={64}
        disabled={!canAdmin}
        uploadFn={(f) => upload.mutateAsync(f)}
        onRemove={canAdmin && active.avatarUrl ? () => remove.mutateAsync() : undefined}
      />
    </SectionCard>
  );
}
