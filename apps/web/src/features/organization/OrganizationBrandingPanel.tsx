import { PERMISSIONS } from '@tirapro/types';
import { AvatarUploader } from '@/components/ui/AvatarUploader';
import { useAuth } from '@/stores/auth';
import {
  useMyOrganizations,
  useUploadOrganizationAvatar,
  useRemoveOrganizationAvatar,
} from './api';
import { ReadOnlyNote } from '@/components/ui/NoAccess';
import { SectionCard } from '@/components/ui/SectionCard';

/** Logo/ảnh của tổ chức đang hoạt động. Chỉ quản trị chung mới đổi được. */
export function OrganizationBrandingPanel() {
  const activeId = useAuth((s) => s.organizationId);
  const canAdmin = useAuth((s) => s.can(PERMISSIONS.ORGANIZATION_ADMIN));
  const { data: organizations = [] } = useMyOrganizations();
  const active = organizations.find((w) => w.id === activeId) ?? organizations[0];

  const upload = useUploadOrganizationAvatar(active?.id ?? '');
  const remove = useRemoveOrganizationAvatar(active?.id ?? '');

  if (!active) return null;

  return (
    <SectionCard data-tour="settings-general-logo">
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
