import { useMemo, useState } from 'react';
import { ListTree, Undo2 } from 'lucide-react';
import type { SchemeIssueTypeDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { SectionCard } from '@/components/ui/SectionCard';
import { Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { useProjects } from '@/features/projects/api';
import { ChangePreviewDialog } from './ChangePreviewDialog';
import { useWorkspaceScheme, type ChangeRequest } from './schemeApi';
import { selectableWorkflows } from './schemeModel';
import type { Workflow } from './api';

/**
 * "Quy trình của tổ chức": mỗi loại việc dùng MỘT quy trình trong toàn tổ chức (bảng loại việc → quy trình). Đổi ô chọn rồi
 * "Lưu thay đổi" mở hộp XEM TRƯỚC (việc sẽ chuyển, quy tắc bị ảnh hưởng, bộ lọc theo tên) — chỉ khi xác nhận mới ghi.
 * Bên dưới liệt kê dự án đang dùng quy trình riêng cho một loại việc, kèm "Quay về dùng chung" (cũng qua xem trước).
 * Chỉ Quản trị chung (API GET/PUT cần `workspace:admin`) — trang chỉ vẽ mục này cho họ.
 */
export function WorkflowSchemeSection({ workflows }: { workflows: Workflow[] }) {
  const schemeQuery = useWorkspaceScheme();
  const scheme = schemeQuery.data;
  const types = useMemo(() => scheme?.issueTypes ?? [], [scheme]);
  const current = useMemo(
    () => new Map((scheme?.items ?? []).map((i) => [i.issueTypeId, i.workflowId])),
    [scheme],
  );
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [request, setRequest] = useState<ChangeRequest | null>(null);
  const [title, setTitle] = useState('Đổi quy trình của tổ chức');

  const shared = useMemo(() => selectableWorkflows(workflows), [workflows]);
  const options = shared.map((w) => ({ value: w.id, label: w.name }));
  const valueOf = (t: SchemeIssueTypeDto) => draft[t.id] ?? current.get(t.id) ?? '';
  const changed = types.filter((t) => draft[t.id] && draft[t.id] !== (current.get(t.id) ?? ''));

  function save() {
    setTitle('Đổi quy trình của tổ chức');
    setRequest({
      scope: 'workspace',
      body: { items: changed.map((t) => ({ issueTypeId: t.id, workflowId: draft[t.id]! })) },
    });
  }

  return (
    <SectionCard
      icon={<ListTree className="h-4 w-4" />}
      title="Quy trình của tổ chức"
      description="Mỗi loại việc dùng một quy trình trong toàn tổ chức. Dự án có thể dùng quy trình riêng cho từng loại."
      actions={
        <Button size="sm" onClick={save} disabled={changed.length === 0 || !scheme}>
          Lưu thay đổi
        </Button>
      }
    >
      {schemeQuery.isPending && (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      {schemeQuery.isError && (
        <QueryError error={schemeQuery.error} onRetry={() => void schemeQuery.refetch()} />
      )}
      {scheme && (
        <>
          <ul
            className="divide-y divide-border rounded-md border border-border"
            data-testid="scheme-rows"
          >
            {types.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-ink">
                  <IssueTypeIcon type={t} />
                  <span className="truncate">{t.name}</span>
                </span>
                <SearchSelect
                  value={valueOf(t)}
                  onChange={(v) => setDraft((d) => ({ ...d, [t.id]: v }))}
                  options={options}
                  placeholder="Chưa chọn quy trình"
                  ariaLabel={`Quy trình cho loại việc ${t.name}`}
                  className="w-full sm:w-64"
                />
              </li>
            ))}
          </ul>
          <OverridesList
            workflows={workflows}
            types={types}
            onRevert={(projectId, typeId, label) => {
              setTitle(`Quay về dùng chung — ${label}`);
              setRequest({
                scope: 'project',
                projectId,
                body: { issueTypeId: typeId, workflowId: null, statusMap: {} },
              });
            }}
          />
        </>
      )}
      <ChangePreviewDialog
        request={request}
        title={title}
        workflows={workflows}
        targetWorkflowOf={(typeId) =>
          request?.scope === 'project'
            ? (current.get(typeId) ?? undefined)
            : (draft[typeId] ?? current.get(typeId))
        }
        onClose={() => setRequest(null)}
        onApplied={() => setDraft({})}
      />
    </SectionCard>
  );
}

/** Dự án đang dùng quy trình riêng (từ `usedBy.overrides` của từng quy trình — chỉ dự án người xem thấy). */
function OverridesList({
  workflows,
  types,
  onRevert,
}: {
  workflows: Workflow[];
  types: SchemeIssueTypeDto[];
  onRevert: (projectId: string, typeId: string, label: string) => void;
}) {
  const { data: projects } = useProjects();
  const rows = useMemo(
    () =>
      workflows.flatMap((w) =>
        (w.usedBy?.overrides ?? []).map((o) => ({
          workflow: w,
          projectKey: o.projectKey,
          typeKey: o.typeKey,
        })),
      ),
    [workflows],
  );
  const hidden = workflows.reduce((n, w) => n + (w.usedBy?.hiddenOverrideCount ?? 0), 0);
  if (rows.length === 0 && hidden === 0) return null;
  return (
    <section aria-labelledby="scheme-overrides" className="mt-5">
      <h3 id="scheme-overrides" className="mb-2 text-sm font-medium text-muted">
        Dự án dùng quy trình riêng{' '}
        <span className="font-normal text-faint">({rows.length + hidden})</span>
      </h3>
      <ul className="divide-y divide-border rounded-md border border-border">
        {rows.map((r) => {
          const project = projects?.find((p) => p.key === r.projectKey);
          const type = types.find((t) => (t.key ?? t.name) === r.typeKey);
          const label = `${r.projectKey} · ${type?.name ?? r.typeKey}`;
          return (
            <li
              key={`${r.projectKey}:${r.typeKey}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
              data-override-row={`${r.projectKey}:${r.typeKey}`}
            >
              <span className="min-w-0 flex-1 text-ink">
                {label} <span className="text-muted">→ {r.workflow.name}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!project || !type}
                onClick={() => project && type && onRevert(project.id, type.id, label)}
                aria-label={`Quay về dùng chung: ${label}`}
              >
                <Undo2 className="h-3.5 w-3.5" />
                Quay về dùng chung
              </Button>
            </li>
          );
        })}
        {hidden > 0 && (
          <li className="px-3 py-2 text-xs text-faint">
            +{hidden} ghi đè ở dự án bạn không xem được
          </li>
        )}
      </ul>
    </section>
  );
}
