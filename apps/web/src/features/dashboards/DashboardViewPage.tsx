import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, LayoutDashboard } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { PrintButton } from '@/components/ui/PrintButton';
import { PrintHeader } from '@/components/ui/PrintHeader';
import { Badge, EmptyState } from '@/components/ui/primitives';
import { pageContainer } from '@/components/layout/page';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import type { CustomDashboardDto } from '@tirapro/shared';
import { useDashboard, useDuplicateDashboard } from './api';
import { scopeBadge, scopeDescription } from './dashboardMeta';
import { DashboardSwitcher } from './DashboardSwitcher';
import { widgetDefOf } from './registry';
import { DASHBOARD_GRID_CLASS, widgetSpanClass } from './widgetLayout';
import { WidgetBoundary, WidgetFrame } from './WidgetFrame';

/** `/dashboards/:id` — xem một dashboard tuỳ biến: lưới ô số liệu (1 cột trên mobile). */
export function DashboardViewPage() {
  const { id } = useParams<{ id: string }>();
  const query = useDashboard(id);
  return (
    <div className={pageContainer('xl', 'py-6')}>
      <QueryBoundary query={query}>
        {(dashboard) => <DashboardView dashboard={dashboard} />}
      </QueryBoundary>
    </div>
  );
}

function DashboardView({ dashboard }: { dashboard: CustomDashboardDto }) {
  const navigate = useNavigate();
  const canManage = useAuth((s) => s.can('dashboard:manage'));
  const duplicate = useDuplicateDashboard();
  const widgets = [...dashboard.widgets].sort((a, b) => a.position.order - b.position.order);

  function copy() {
    duplicate.mutate(dashboard.id, {
      onSuccess: (copy) => {
        toast.success('Đã tạo bản sao riêng tư của bạn');
        navigate(`/dashboards/${copy.id}?edit=1`);
      },
      onError: (err) => toast.error(apiErrorMessage(err)),
    });
  }

  return (
    <>
      <PrintHeader title={dashboard.name} subtitle={scopeDescription(dashboard)} />
      <header className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 print:hidden">
        <div className="min-w-0">
          <Link
            to="/"
            className="mb-1 inline-flex items-center gap-1 rounded-sm text-xs text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Tổng quan
          </Link>
          <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-semibold tracking-tight text-ink-strong">
            <span className="min-w-0 break-words">{dashboard.name}</span>
            <Badge className="bg-surface-2 text-muted" title={scopeDescription(dashboard)}>
              {scopeBadge(dashboard)}
            </Badge>
          </h1>
          {dashboard.description && (
            <p className="mt-1 max-w-2xl text-sm text-muted">{dashboard.description}</p>
          )}
          {!dashboard.isMine && (
            <p className="mt-1 text-xs text-faint">Của {dashboard.owner.displayName}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DashboardSwitcher currentId={dashboard.id} />
          {!dashboard.canEdit && canManage && (
            <Button size="sm" variant="secondary" onClick={copy} loading={duplicate.isPending}>
              <Copy className="h-4 w-4" aria-hidden /> Tạo bản sao để chỉnh sửa
            </Button>
          )}
          {widgets.length > 0 && <PrintButton title={dashboard.name} />}
        </div>
      </header>

      {widgets.length === 0 ? (
        <EmptyState
          icon={<LayoutDashboard className="h-8 w-8" />}
          title="Dashboard trống — thêm widget đầu tiên"
          description={
            dashboard.canEdit
              ? 'Thêm ô số liệu, biểu đồ hay danh sách việc để dashboard có nội dung.'
              : 'Chủ dashboard chưa thêm ô nào.'
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
