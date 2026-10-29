import type { ReactNode } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
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
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { SubNavLayout } from '@/components/layout/SubNavLayout';
import type { SubNavGroup } from '@/components/layout/subNavModel';
import { useAuth } from '@/stores/auth';
import { useCan } from '@/features/projects/permissions';
import {
  useProject,
  useUploadProjectAvatar,
  useRemoveProjectAvatar,
} from '@/features/projects/api';
import { GeneralSection } from './GeneralSection';
import { SectionCard } from '@/components/ui/SectionCard';
import { MembersSection } from './MembersSection';
import { ComponentsSection } from './ComponentsSection';
import { VersionsSection } from './VersionsSection';
import { LabelsSection } from './LabelsSection';
import { DataSection } from './DataSection';
import { PROJECT_CONFIG_LABELS } from '@/lib/navLabels';
import {
  configRedirectTarget,
  configSectionPath,
  isConfigSection,
  type ConfigSectionId,
} from './configSections';

const CONFIG_TITLE = 'Cấu hình';

interface ConfigSectionDef {
  id: ConfigSectionId;
  label: string;
  icon: ReactNode;
  /** Mô tả một dòng dưới tiêu đề mục (mục nhiều thẻ như Chung tự có mô tả trong từng thẻ). */
  description?: string;
}

/** Các mục con của Cấu hình (submenu). */
const CONFIG_NAV: ConfigSectionDef[] = [
  {
    id: 'general',
    label: PROJECT_CONFIG_LABELS.general,
    icon: <SlidersHorizontal className="h-4 w-4" />,
  },
  { id: 'members', label: PROJECT_CONFIG_LABELS.members, icon: <Users className="h-4 w-4" /> },
  {
    id: 'components',
    label: PROJECT_CONFIG_LABELS.components,
    icon: <Boxes className="h-4 w-4" />,
    description: 'Chia công việc theo từng phần chức năng hoặc từng khối của dự án.',
  },
  {
    id: 'versions',
    label: PROJECT_CONFIG_LABELS.versions,
    icon: <Tag className="h-4 w-4" />,
    description: 'Theo dõi các mốc phát hành (release) của dự án.',
  },
  {
    id: 'labels',
    label: PROJECT_CONFIG_LABELS.labels,
    icon: <Tags className="h-4 w-4" />,
    description: 'Gắn nhãn cho công việc để nhóm và lọc theo cách của riêng bạn.',
  },
  {
    id: 'data',
    label: PROJECT_CONFIG_LABELS.data,
    icon: <Download className="h-4 w-4" />,
    description:
      'Sao lưu dự án ra tệp JSON, hoặc nhập công việc hàng loạt từ biểu mẫu Excel, tệp CSV / JSON.',
  },
];

/**
 * Khung Cấu hình dự án: mỗi mục là một route con `/p/:key/config/:section` (SubNavLayout, chế độ route). Đổi mục là đổi
 * pathname nên `LeaveGuardHost` bắt form chưa lưu (không cần `useConfirmDiscard` thủ công như khi mục chỉ là state).
 * Trang nằm dưới header dự án (h1 = tên dự án) nên tiêu đề mục là h2 (`variant="tab"`), cả danh sách mục trên mobile.
 */
export function ProjectConfigPage() {
  const { key = '' } = useParams();
  const groups: SubNavGroup[] = [
    {
      items: CONFIG_NAV.map((i) => ({
        to: configSectionPath(key, i.id),
        label: i.label,
        icon: i.icon,
      })),
    },
  ];
  return (
    <SubNavLayout
      title={CONFIG_TITLE}
      ariaLabel="Mục cấu hình dự án"
      groups={groups}
      basePath={`/p/${key}/config`}
      frameSize="sm"
      variant="tab"
    />
  );
}

/** `/p/:key/config` (và liên kết kiểu `?section=`) → route con của mục tương ứng; mặc định Chung. */
export function ConfigIndexRedirect() {
  const { key = '' } = useParams();
  const { search } = useLocation();
  return <Navigate to={configRedirectTarget(key, search)} replace />;
}

/** `/p/:key/config/:section` — mục lạ → Chung. */
export function ConfigSection() {
  const { key = '', section } = useParams();
  const { search } = useLocation();
  const { data: project } = useProject(key);
  const projectId = project?.id;
  const canAdmin = useCan(projectId)('project:admin');
  const canImport = useAuth((s) => s.can('import:run'));

  if (!isConfigSection(section)) {
    return <Navigate to={{ pathname: configSectionPath(key, 'general'), search }} replace />;
  }
  const def = CONFIG_NAV.find((s) => s.id === section)!;
  const description =
    section === 'members'
      ? project?.isPrivate
        ? 'Dự án riêng tư — chỉ người ở đây và quản trị thấy được.'
        : 'Mọi thành viên không gian làm việc đều tham gia; đặt vai trò riêng cho từng người khi cần.'
      : def.description;

  return (
    <PageFrame size="sm">
      <PageHeader variant="tab" title={def.label} description={description} />
      <div className="space-y-8">
        {section === 'general' && project && (
          <>
            <GeneralSection key={project.id} project={project} canAdmin={canAdmin} />
            <ProjectAvatarSection projectKey={key} name={project.name} src={project.avatarUrl} />
          </>
        )}
        {section === 'members' && (
          <MembersSection projectId={projectId} isPrivate={project?.isPrivate ?? false} />
        )}
        {section === 'components' && (
          <ComponentsSection projectId={projectId} canAdmin={canAdmin} />
        )}
        {section === 'versions' && <VersionsSection projectId={projectId} canAdmin={canAdmin} />}
        {section === 'labels' && <LabelsSection projectId={projectId} canAdmin={canAdmin} />}
        {section === 'data' && (
          <DataSection projectId={projectId} projectKey={key} canImport={canImport} />
        )}
      </div>
    </PageFrame>
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
      headingLevel={3}
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
