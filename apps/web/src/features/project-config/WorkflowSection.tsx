import { useMemo, useState } from 'react';
import { GitBranch, Network } from 'lucide-react';
import type { ProjectWorkflowSchemeItemDto, SchemeIssueTypeDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { ReadOnlyNote } from '@/components/ui/NoAccess';
import { SearchSelect, type SearchSelectOption } from '@/components/ui/SearchSelect';
import { SectionCard } from '@/components/ui/SectionCard';
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { ChangePreviewDialog } from '@/features/workflow-settings/ChangePreviewDialog';
import { WorkflowEditDialog } from '@/features/workflow-settings/WorkflowEditDialog';
import { useWorkflows, type Workflow } from '@/features/workflow-settings/api';
import { useProjectScheme, type ChangeRequest } from '@/features/workflow-settings/schemeApi';
import { selectableWorkflows } from '@/features/workflow-settings/schemeModel';

/** Giá trị đặc biệt của ô chọn: quay về dùng chung của tổ chức / tạo bản riêng (chép) từ quy trình của tổ chức. */
const SHARED = '__shared';
const COPY = '__copy';

/**
 * Cấu hình dự án → "Quy trình": mỗi loại việc một hàng — quy trình ĐANG DÙNG (kèm huy hiệu "Theo tổ chức" / "Riêng của dự án"),
 * ô chọn đổi, và "Xem sơ đồ". Đổi → hộp XEM TRƯỚC (việc chuyển, quy tắc, bộ lọc theo tên) rồi mới ghi. "Theo tổ chức" quay về
 * dùng chung (PUT `workflowId: null`); "Tạo bản riêng từ …" chép quy trình của tổ chức thành bản riêng của dự án rồi mở hộp
 * thoại quy trình để sửa. Quản trị dự án / Quản trị chung / SA sửa được; người khác (và dự án đã lưu trữ) chỉ xem.
 */
export function WorkflowSection({
  projectId,
  canAdmin,
  archived = false,
}: {
  projectId: string | undefined;
  canAdmin: boolean;
  /** Dự án đã lưu trữ: chỉ xem, ghi chú nêu đúng lý do. */
  archived?: boolean;
}) {
  const schemeQuery = useProjectScheme(projectId);
  const workflowsQuery = useWorkflows();
  const workflows = useMemo(() => workflowsQuery.data ?? [], [workflowsQuery.data]);
  const scheme = schemeQuery.data;
  const types = scheme?.issueTypes ?? [];
  const byId = useMemo(() => new Map(workflows.map((w) => [w.id, w])), [workflows]);
  const shared = useMemo(() => selectableWorkflows(workflows), [workflows]);

  const [request, setRequest] = useState<ChangeRequest | null>(null);
  const [title, setTitle] = useState('Đổi quy trình của dự án');
  const [openCopyFor, setOpenCopyFor] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);

  function choose(
    type: SchemeIssueTypeDto,
    item: ProjectWorkflowSchemeItemDto | undefined,
    v: string,
  ) {
    if (!projectId) return;
    setTitle(`Quy trình của dự án — ${type.name}`);
    if (v === SHARED) {
      setOpenCopyFor(null);
      setRequest({
        scope: 'project',
        projectId,
        body: { issueTypeId: type.id, workflowId: null, statusMap: {} },
      });
    } else if (v === COPY) {
      setOpenCopyFor(type.id);
      setRequest({
        scope: 'project',
        projectId,
        body: {
          issueTypeId: type.id,
          workflowId: item?.workspaceWorkflowId ?? item?.workflowId ?? '',
          statusMap: {},
          copy: true,
        },
      });
    } else {
      setOpenCopyFor(null);
      setRequest({
        scope: 'project',
        projectId,
        body: { issueTypeId: type.id, workflowId: v, statusMap: {} },
      });
    }
  }

  async function afterApplied() {
    const typeId = openCopyFor;
    setOpenCopyFor(null);
    if (!typeId) return;
    // Bản riêng vừa tạo: nạp lại rồi mở hộp thoại quy trình để sửa ngay.
    const fresh = await schemeQuery.refetch();
    await workflowsQuery.refetch();
    const wid = fresh.data?.items.find((i) => i.issueTypeId === typeId)?.workflowId;
    if (wid) setViewId(wid);
  }

  const loading = schemeQuery.isPending || workflowsQuery.isPending;
  const error = schemeQuery.error ?? workflowsQuery.error;
  const viewWorkflow = viewId ? (byId.get(viewId) ?? null) : null;

  return (
    <SectionCard>
      {archived ? (
        <ReadOnlyNote message="Dự án đã lưu trữ — hãy khôi phục dự án để sửa quy trình." />
      ) : (
        !canAdmin && <ReadOnlyNote />
      )}
      {loading && (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}
      {error && (
        <QueryError
          error={error}
          onRetry={() => {
            void schemeQuery.refetch();
            void workflowsQuery.refetch();
          }}
        />
      )}
      {scheme && !loading && types.length === 0 && (
        <EmptyState
          icon={<GitBranch className="h-6 w-6" />}
          title="Chưa có loại việc nào"
          description="Tổ chức chưa có loại việc để gán quy trình."
        />
      )}
      {scheme && !loading && types.length > 0 && (
        <ul
          className="divide-y divide-border rounded-md border border-border"
          data-testid="project-scheme-rows"
        >
          {types.map((t) => {
            const item = scheme.items.find((i) => i.issueTypeId === t.id);
            const wf = item ? byId.get(item.workflowId) : undefined;
            return (
              <li
                key={t.id}
                data-type-row={t.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
              >
                <span className="flex w-40 shrink-0 items-center gap-2 text-sm text-ink">
                  <IssueTypeIcon type={t} />
                  <span className="truncate">{t.name}</span>
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <span className="truncate font-medium text-ink">
                    {wf?.name ?? (item ? 'Quy trình đã ẩn' : 'Chưa có quy trình')}
                  </span>
                  {item && (
                    <Badge
                      className={
                        item.isOverride
                          ? 'bg-primary-subtle text-primary'
                          : 'bg-surface-2 text-muted'
                      }
                    >
                      {item.isOverride ? 'Riêng của dự án' : 'Theo tổ chức'}
                    </Badge>
                  )}
                </span>
                {canAdmin && (
                  <SearchSelect
                    value={item ? (item.isOverride ? item.workflowId : SHARED) : ''}
                    onChange={(v) => choose(t, item, v)}
                    options={optionsFor(item, shared, byId)}
                    placeholder="Chọn quy trình"
                    ariaLabel={`Quy trình cho loại việc ${t.name}`}
                    className="w-full sm:w-64"
                  />
                )}
                {wf && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setViewId(wf.id)}
                    aria-label={`Xem sơ đồ quy trình ${wf.name}`}
                    data-workflow-row={wf.id}
                  >
                    <Network className="h-3.5 w-3.5" />
                    Xem sơ đồ
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ChangePreviewDialog
        request={request}
        title={title}
        workflows={workflows}
        targetWorkflowOf={(typeId) => {
          const item = scheme?.items.find((i) => i.issueTypeId === typeId);
          return request?.scope === 'project' && request.body.issueTypeId === typeId
            ? (request.body.workflowId ?? item?.workspaceWorkflowId ?? undefined)
            : item?.workflowId;
        }}
        onClose={() => {
          setRequest(null);
          setOpenCopyFor(null);
        }}
        onApplied={() => void afterApplied()}
      />
      <WorkflowEditDialog workflow={viewWorkflow} onClose={() => setViewId(null)} />
    </SectionCard>
  );
}

/** Các lựa chọn của một hàng: theo tổ chức, mọi quy trình dùng chung, bản riêng đang dùng (nếu có), tạo bản riêng. */
function optionsFor(
  item: ProjectWorkflowSchemeItemDto | undefined,
  shared: Workflow[],
  byId: Map<string, Workflow>,
): SearchSelectOption[] {
  const out: SearchSelectOption[] = [];
  const orgId = item?.workspaceWorkflowId ?? null;
  if (orgId)
    out.push({
      value: SHARED,
      label: `Theo tổ chức (${byId.get(orgId)?.name ?? 'quy trình của tổ chức'})`,
      group: 'Dùng chung',
    });
  for (const w of shared) out.push({ value: w.id, label: w.name, group: 'Quy trình của tổ chức' });
  if (item?.isOverride && !shared.some((w) => w.id === item.workflowId)) {
    out.push({
      value: item.workflowId,
      label: `${byId.get(item.workflowId)?.name ?? 'Quy trình riêng'} (riêng của dự án)`,
      group: 'Riêng của dự án',
    });
  }
  // "Tạo bản riêng" chỉ khi quy trình đang dùng CHƯA là của dự án (đã riêng rồi thì sửa thẳng nó) và nguồn chép là quy trình chung.
  const source = orgId ?? item?.workflowId;
  const effective = item ? byId.get(item.workflowId) : undefined;
  const sourceWf = source ? byId.get(source) : undefined;
  const alreadyOwned = !!effective && effective.projectId !== null;
  const sourceIsShared = !sourceWf || sourceWf.projectId === null;
  if (source && !alreadyOwned && sourceIsShared)
    out.push({
      value: COPY,
      label: `Tạo bản riêng từ ${byId.get(source)?.name ?? 'quy trình hiện tại'}`,
      group: 'Tạo mới',
    });
  return out;
}
