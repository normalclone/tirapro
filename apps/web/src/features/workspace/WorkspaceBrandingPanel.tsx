import { Building2 } from 'lucide-react';
import { PERMISSIONS } from '@tirapro/types';
import { AvatarUploader } from '@/components/ui/AvatarUploader';
import { useAuth } from '@/stores/auth';
import {
  useMyWorkspaces,
  useUploadWorkspaceAvatar,
  useRemoveWorkspaceAvatar,
} from './api';

/** Logo/ảnh workspace đang hoạt động. Chỉ workspace admin mới đổi được. */
export function WorkspaceBrandingPanel() {
  const activeId = useAuth((s) => s.workspaceId);
  const canAdmin = useAuth((s) => s.can(PERMISSIONS.WORKSPACE_ADMIN));
  const { data: workspaces = [] } = useMyWorkspaces();
  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];

  const upload = useUploadWorkspaceAvatar(active?.id ?? '');
  const remove = useRemoveWorkspaceAvatar(active?.id ?? '');

  if (!active) return null;

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
          <Building2 className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink-strong">Logo workspace</h2>
          <p className="mt-0.5 text-sm text-muted">
            Hiển thị ở thanh chuyển workspace. {!canAdmin && 'Chỉ admin mới đổi được.'}
          </p>
        </div>
      </div>

      <div className="p-5">
        <AvatarUploader
          name={active.name}
          src={active.avatarUrl}
          shape="rounded"
          size={64}
          disabled={!canAdmin}
          uploadFn={(f) => upload.mutateAsync(f)}
          onRemove={canAdmin && active.avatarUrl ? () => remove.mutateAsync() : undefined}
        />
      </div>
    </section>
  );
}
