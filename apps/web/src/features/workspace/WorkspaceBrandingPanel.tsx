import { PERMISSIONS } from '@tirapro/types';
import { AvatarUploader } from '@/components/ui/AvatarUploader';
import { useAuth } from '@/stores/auth';
import { useMyWorkspaces, useUploadWorkspaceAvatar, useRemoveWorkspaceAvatar } from './api';
import { ReadOnlyNote } from '@/components/ui/NoAccess';
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
    <SectionCard>
      {!canAdmin && <ReadOnlyNote />}
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
