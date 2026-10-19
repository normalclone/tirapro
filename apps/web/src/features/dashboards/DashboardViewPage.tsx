import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Copy, LayoutDashboard, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { NoAccess } from '@/components/ui/NoAccess';
import { useConfirm } from '@/components/ui/useConfirm';
import { PrintButton } from '@/components/ui/PrintButton';
import { PrintHeader } from '@/components/ui/PrintHeader';
import { Badge, EmptyState } from '@/components/ui/primitives';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import type { CustomDashboardDto } from '@tirapro/shared';
import { useDashboard, useDeleteDashboard, useDuplicateDashboard } from './api';
import { DashboardEditor } from './DashboardEditor';
import { scopeBadge, scopeDescription } from './dashboardMeta';
import { DashboardSwitcher } from './DashboardSwitcher';
import { widgetDefOf } from './registry';
import { DASHBOARD_GRID_CLASS, widgetSpanClass } from './widgetLayout';
import { WidgetBoundary, WidgetFrame } from './WidgetFrame';

/**
 * `/dashboards/:id` — xem một dashboard tuỳ biến (lưới ô số liệu, 1 cột trên mobile); `?edit=1` vào chế độ soạn (chỉ chủ);
 * `/dashboards/new` soạn dashboard mới.
 */
export function DashboardViewPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const canManage = useAuth((s) => s.can('dashboard:manage'));
  const isNew = id === 'new';
  const query = useDashboard(isNew ? undefined : id);

  if (isNew) {
    return canManage ? (
      <DashboardEditor dashboard={null} />
    ) : (
      <NoAccess who="người được cấp quyền quản lý bảng tổng quan" />
    );
  }
  const editing = params.get('edit') === '1';
  return (
    <QueryBoundary query={query}>
      {(dashboard) =>
        editing && dashboard.canEdit && canManage ? (
          // `key`: nạp lại bản mới (sau "Tải lại" khi bị 409) thì khởi tạo lại bản nháp từ dữ liệu mới.
          <DashboardEditor
            key={dashboard.updatedAt}
            dashboard={dashboard}
            onReload={() => void query.refetch()}
          />
        ) : (
          <PageFrame size="xl" className="py-6">
            <DashboardView dashboard={dashboard} canManage={canManage} />
          </PageFrame>
        )
      }
    </QueryBoundary>
  );
}

function DashboardView({
  dashboard,
  canManage,
}: {
  dashboard: CustomDashboardDto;
  canManage: boolean;
}) {
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const confirm = useConfirm();
  const duplicate = useDuplicateDashboard();
  const remove = useDeleteDashboard();
  const widgets = [...dashboard.widgets].sort((a, b) => a.position.order - b.position.order);

  function copy() {
    duplicate.mutate(dashboard.id, {
      onSuccess: (created) => {
        toast.success('Đã tạo bản sao riêng tư của bạn');
        navigate(`/dashboards/${created.id}?edit=1`);
      },
      onError: (err) => toast.error(apiErrorMessage(err)),
    });
  }

  async function onDelete() {
    const ok = await confirm({
      title: `Xoá bảng tổng quan “${dashboard.name}”?`,
      description:
        dashboard.scope === 'PRIVATE'
          ? 'Bảng tổng quan bị xoá không khôi phục được.'
          : 'Những người đang được chia sẻ sẽ không còn thấy bảng tổng quan này. Không khôi phục được.',
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(dashboard.id, {
      onSuccess: () => {
        toast.success('Đã xoá bảng tổng quan');
        navigate('/');
      },
      onError: (err) => toast.error(apiErrorMessage(err)),
    });
  }

  return (
    <>
      <PrintHeader title={dashboard.name} subtitle={scopeDescription(dashboard)} />
      <PageHeader
        className="print:hidden"
        breadcrumb={[{ label: 'Tổng quan', to: '/' }, { label: dashboard.name }]}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 break-words">{dashboard.name}</span>
            <Badge className="bg-surface-2 text-muted" title={scopeDescription(dashboard)}>
              {scopeBadge(dashboard)}
            </Badge>
          </span>
        }
        description={
          dashboard.description || !dashboard.isMine ? (
            <>
              {dashboard.description}
              {!dashboard.isMine && (
                <span
                  className={
                    dashboard.description ? 'mt-1 block text-xs text-faint' : 'text-xs text-faint'
                  }
                >
                  Của {dashboard.owner.displayName}
                </span>
              )}
            </>
          ) : undefined
        }
        actions={
          <>
            <DashboardSwitcher currentId={dashboard.id} />
            {!dashboard.canEdit && canManage && (
              <Button size="sm" variant="secondary" onClick={copy} loading={duplicate.isPending}>
                <Copy className="h-4 w-4" aria-hidden /> Tạo bản sao để chỉnh sửa
              </Button>
            )}
            {dashboard.canEdit && canManage && (
              <Button size="sm" onClick={() => setParams({ edit: '1' })}>
                <Pencil className="h-4 w-4" aria-hidden /> Chỉnh sửa
              </Button>
            )}
            {widgets.length > 0 && <PrintButton title={dashboard.name} />}
            {dashboard.canDelete && canManage && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void onDelete()}
                loading={remove.isPending}
                aria-label="Xoá bảng tổng quan"
                title="Xoá bảng tổng quan"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </>
        }
      />

      {widgets.length === 0 ? (
        <EmptyState
          icon={<LayoutDashboard className="h-8 w-8" />}
          title={
            dashboard.canEdit
              ? 'Bảng tổng quan trống — thêm widget đầu tiên'
              : 'Bảng tổng quan này chưa có widget nào'
          }
          description={
            dashboard.canEdit
              ? 'Thêm ô số liệu, biểu đồ hay danh sách việc để bảng tổng quan có nội dung.'
              : 'Chủ bảng tổng quan chưa thêm ô nào.'
          }
          action={
            dashboard.canEdit && canManage ? (
              <Button variant="secondary" size="sm" onClick={() => setParams({ edit: '1' })}>
                <Plus className="h-4 w-4" aria-hidden /> Thêm widget
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={DASHBOARD_GRID_CLASS}>
          {widgets.map((w) => {
            const def = widgetDefOf(w.type);
            return (
              <div key={w.id} className={widgetSpanClass(w.position.w)}>
                {def ? (
                  <WidgetBoundary title={w.title}>
                    <def.Component title={w.title} config={w.config} />
                  </WidgetBoundary>
                ) : (
                  <WidgetFrame
                    title={w.title}
                    state="empty"
                    emptyText="Loại ô này chưa được phiên bản hiện tại hỗ trợ"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
