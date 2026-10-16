import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  Boxes,
  Tag,
  Tags,
  Download,
  Image as ImageIcon,
  Users,
  SlidersHorizontal,
} from 'lucide-react';
import { AvatarUploader } from '@/components/ui/AvatarUploader';
import { pageContainer } from '@/components/layout/page';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { useCan } from '@/features/projects/permissions';
import {
  useProject,
  useUploadProjectAvatar,
  useRemoveProjectAvatar,
} from '@/features/projects/api';
import { GeneralSection } from './GeneralSection';
import { SectionCard } from './SectionCard';
import { MembersSection } from './MembersSection';
import { ComponentsSection } from './ComponentsSection';
import { VersionsSection } from './VersionsSection';
import { LabelsSection } from './LabelsSection';
import { DataSection } from './DataSection';

/** Khóa nhận diện từng mục cấu hình trong submenu. */
type ConfigSectionId = 'general' | 'members' | 'components' | 'versions' | 'labels' | 'data';

interface ConfigSectionDef {
  id: ConfigSectionId;
  label: string;
  icon: ReactNode;
}

/** Các mục con của Cấu hình (submenu dọc). */
const CONFIG_NAV: ConfigSectionDef[] = [
  { id: 'general', label: 'Chung', icon: <SlidersHorizontal className="h-4 w-4" /> },
  { id: 'members', label: 'Thành viên', icon: <Users className="h-4 w-4" /> },
  { id: 'components', label: 'Thành phần', icon: <Boxes className="h-4 w-4" /> },
  { id: 'versions', label: 'Phiên bản', icon: <Tag className="h-4 w-4" /> },
  { id: 'labels', label: 'Nhãn', icon: <Tags className="h-4 w-4" /> },
  { id: 'data', label: 'Xuất / Nhập dữ liệu', icon: <Download className="h-4 w-4" /> },
];

export function ProjectConfigPage() {
  const { key = '' } = useParams();
  const { data: project } = useProject(key);
  const projectId = project?.id;

  const canAdmin = useCan(projectId)('project:admin');
  const canImport = useAuth((s) => s.can('import:run'));

  const [active, setActive] = useState<ConfigSectionId>('general');

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* Submenu: rail dọc trên desktop, hàng pill cuộn ngang trên mobile */}
      <nav
        aria-label="Mục cấu hình dự án"
        className={cn(
          'shrink-0 border-border bg-surface',
          'flex gap-1 overflow-x-auto border-b px-3 py-2',
          'lg:w-60 lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-5',
        )}
      >
        <h1 className="hidden px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-faint lg:block">
          Cấu hình
        </h1>
        {CONFIG_NAV.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => setActive(item.id)}
              className={cn(
                'flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                isActive
                  ? 'bg-primary-subtle text-primary'
                  : 'text-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 flex-1 overflow-auto">
        <div className={pageContainer('sm')}>
          <header className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">
              {project?.name ?? 'Dự án'}
            </h1>
            <p className="mt-1 text-sm text-muted">
              Cấu hình · {CONFIG_NAV.find((s) => s.id === active)?.label}
            </p>
          </header>

          <div className="space-y-8">
            {active === 'general' && project && (
              <>
                <GeneralSection key={project.id} project={project} canAdmin={canAdmin} />
                <ProjectAvatarSection
                  projectKey={key}
                  name={project.name}
                  src={project.avatarUrl}
                />
              </>
            )}
            {active === 'members' && (
              <MembersSection projectId={projectId} isPrivate={project?.isPrivate ?? false} />
            )}
            {active === 'components' && (
              <ComponentsSection projectId={projectId} canAdmin={canAdmin} />
            )}
            {active === 'versions' && <VersionsSection projectId={projectId} canAdmin={canAdmin} />}
            {active === 'labels' && <LabelsSection projectId={projectId} canAdmin={canAdmin} />}
            {active === 'data' && <DataSection projectId={projectId} canImport={canImport} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section — Ảnh dự án                                                  */
/* ------------------------------------------------------------------ */

function ProjectAvatarSection({
  projectKey,
  name,
  src,
}: {
  projectKey: string;
  name: string;
  src?: string | null;
}) {
  const upload = useUploadProjectAvatar(projectKey);
  const remove = useRemoveProjectAvatar(projectKey);
  return (
    <SectionCard
      icon={<ImageIcon className="h-4 w-4" />}
      title="Ảnh dự án"
      description="Biểu tượng hiển thị cạnh tên dự án."
    >
      <AvatarUploader
        name={name}
        src={src}
        shape="rounded"
        size={64}
        uploadFn={(f) => upload.mutateAsync(f)}
        onRemove={src ? () => remove.mutateAsync() : undefined}
      />
    </SectionCard>
  );
}
