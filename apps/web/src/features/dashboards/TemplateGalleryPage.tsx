import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { DashboardTemplate } from '@tirapro/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { NoAccess } from '@/components/ui/NoAccess';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { RadioCard } from '@/components/ui/RadioCard';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { useProjects } from '@/features/projects/api';
import { usePrograms } from '@/features/projects/groups/programsApi';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { DataScopePicker } from './scope/DataScopePicker';
import {
  dataScopeIssue,
  initialScopeFor,
  toScopeFields,
  type DataScopeValue,
} from './scope/dataScopeModel';
import { TemplatePreview } from './TemplatePreview';
import { useCreateFromTemplate, useDashboardTemplates } from './templatesApi';

/**
 * `/dashboards/new` — thư viện mẫu: chọn mẫu (xem trước sơ đồ khối) → chọn phạm vi dữ liệu → đặt tên (tuỳ chọn) → Tạo.
 * Bảng sinh ra RIÊNG TƯ, đã có ô và bố cục; chia sẻ chỉnh sau trong màn soạn.
 */
export function TemplateGalleryPage() {
  const canManage = useAuth((s) => s.can('dashboard:manage'));
  const query = useDashboardTemplates(canManage);
  if (!canManage) return <NoAccess who="người được cấp quyền quản lý bảng tổng quan" />;
  return (
    <PageFrame size="xl" className="py-6">
      <PageHeader
        breadcrumb={[{ label: 'Tổng quan', to: '/' }, { label: 'Tạo bảng tổng quan' }]}
        title="Tạo bảng tổng quan"
        description="Chọn một mẫu dựng sẵn, chọn dữ liệu lấy từ đâu, rồi chỉnh tiếp nếu cần."
      />
      <QueryBoundary query={query}>
        {({ templates, canUseOrgScope }) => (
          <GalleryBody templates={templates} canOrg={canUseOrgScope} />
        )}
      </QueryBoundary>
    </PageFrame>
  );
}

function GalleryBody({ templates, canOrg }: { templates: DashboardTemplate[]; canOrg: boolean }) {
  const navigate = useNavigate();
  const create = useCreateFromTemplate();
  const { data: projects } = useProjects();
  const { data: programs } = usePrograms();
  const [key, setKey] = useState(templates[0]?.key ?? '');
  const template = templates.find((t) => t.key === key) ?? templates[0]!;
  const [scope, setScope] = useState<DataScopeValue>(() => initialScopeFor(template, canOrg));
  const [name, setName] = useState('');

  function pick(k: string) {
    const next = templates.find((t) => t.key === k);
    if (!next) return;
    setKey(k);
    // Phạm vi đang chọn không hợp với mẫu mới → về phạm vi gợi ý của mẫu (giữ nguyên nếu vẫn dùng được).
    if (!next.scopes.includes(scope.dataScope)) setScope(initialScopeFor(next, canOrg));
  }

  const targetName =
    scope.dataScope === 'PROJECT'
      ? projects?.find((p) => p.id === scope.scopeProjectId)?.name
      : scope.dataScope === 'GROUP'
        ? programs?.find((g) => g.id === scope.scopeProgramId)?.name
        : undefined;
  const defaultName = targetName ? `${template.name} · ${targetName}` : template.name;
  const issue = dataScopeIssue(scope);

  const options = useMemo(
    () => templates.map((t) => ({ value: t.key, label: t.name, description: t.description })),
    [templates],
  );

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (issue || create.isPending) return;
    create.mutate(
      {
        templateKey: template.key,
        ...toScopeFields(scope),
        ...(name.trim() ? { name: name.trim() } : {}),
      },
      {
        onSuccess: (dto) => {
          toast.success(`Đã tạo “${dto.name}”`);
          navigate(`/dashboards/${dto.id}`, { replace: true });
        },
        onError: (err) => toast.error(apiErrorMessage(err)),
      },
    );
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]"
      aria-label="Tạo bảng tổng quan từ mẫu"
    >
      <section aria-labelledby="tpl-list">
        <h2 id="tpl-list" className="mb-2 text-sm font-medium text-ink-strong">
          1. Chọn mẫu
        </h2>
        <RadioCard ariaLabelledby="tpl-list" value={key} onChange={pick} options={options} />
      </section>

      <div className="min-w-0 space-y-5">
        <section aria-labelledby="tpl-preview">
          <h2 id="tpl-preview" className="mb-2 text-sm font-medium text-ink-strong">
            Xem trước: {template.name}
          </h2>
          <TemplatePreview template={template} scope={scope.dataScope} />
        </section>

        <section aria-labelledby="tpl-scope">
          <h2 id="tpl-scope" className="mb-2 text-sm font-medium text-ink-strong">
            2. Dữ liệu lấy từ đâu
          </h2>
          <DataScopePicker
            value={scope}
            onChange={setScope}
            canOrg={canOrg}
            allowed={template.scopes}
            ariaLabel="Phạm vi dữ liệu của bảng"
          />
          {issue && (
            <p role="status" className="mt-1.5 text-xs text-muted">
              {issue} để tạo bảng.
            </p>
          )}
        </section>

        <section aria-labelledby="tpl-name">
          <h2 id="tpl-name" className="mb-2 text-sm font-medium text-ink-strong">
            3. Tên bảng
          </h2>
          <Input
            aria-label="Tên bảng"
            value={name}
            maxLength={120}
            placeholder={defaultName}
            onChange={(e) => setName(e.target.value)}
            className="max-w-md"
          />
          <p className="mt-1 text-xs text-muted">
            Để trống để dùng tên gợi ý. Bảng mới chỉ mình bạn xem.
          </p>
        </section>

        <div className="flex items-center gap-2">
          <Button type="submit" loading={create.isPending} disabled={!!issue}>
            Tạo bảng tổng quan
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            Huỷ
          </Button>
        </div>
      </div>
    </form>
  );
}
