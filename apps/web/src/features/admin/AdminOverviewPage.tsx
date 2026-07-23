import { RefreshCw } from 'lucide-react';
import { pageContainer } from '@/components/layout/page';
import { Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { useAdminOverview } from './api';
import { StatTile, StatusPill, fmtBytes, fmtInt, relTime } from './_ui';

export function AdminOverviewPage() {
  const { data, isLoading, isError, error, isFetching, refetch } = useAdminOverview();

  return (
    <div className={pageContainer('xl')}>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Tổng quan hệ thống</h1>
          <p className="mt-1 text-sm text-muted">Sức khoẻ &amp; quy mô toàn hệ thống, cập nhật tự động.</p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <RefreshCw className={isFetching ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
          {data ? relTime(data.generatedAt) : 'Làm mới'}
        </button>
      </header>

      {isError ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-11 w-full" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Trạng thái dịch vụ (degrade-graceful) */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink">Trạng thái dịch vụ</h2>
            <div className="flex flex-wrap gap-2">
              <StatusPill tone={data.degrade.db ? 'ok' : 'down'} label="Cơ sở dữ liệu" note={data.degrade.db ? 'hoạt động' : 'mất kết nối'} />
              <StatusPill tone={data.degrade.redis ? 'ok' : 'warn'} label="Redis" note={data.degrade.redis ? 'hoạt động' : 'giảm cấp'} />
              <StatusPill
                tone={data.degrade.ai ? 'ok' : 'warn'}
                label="AI"
                note={data.degrade.ai ? 'bật' : data.degrade.aiConfigured ? 'tắt (kill-switch)' : 'heuristic'}
              />
              <StatusPill
                tone={data.degrade.embedding ? 'ok' : 'warn'}
                label="Embedding"
                note={data.degrade.embedding ? data.degrade.embeddingProvider : 'full-text'}
              />
              <StatusPill tone={data.degrade.storage ? 'ok' : 'down'} label="Lưu trữ" note={data.degrade.storageDriver} />
            </div>
          </section>

          {/* Quy mô nội dung */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink">Quy mô</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <StatTile
                label="Workspace"
                value={fmtInt(data.workspaces.active)}
                sub={data.workspaces.archived > 0 ? `${fmtInt(data.workspaces.archived)} đã lưu trữ` : 'không có lưu trữ'}
              />
              <StatTile
                label="Người dùng"
                value={fmtInt(data.users.active)}
                sub={`${fmtInt(data.users.systemAdmins)} admin · ${fmtInt(data.users.deactivated)} vô hiệu`}
              />
              <StatTile label="Dự án" value={fmtInt(data.projects)} />
              <StatTile label="Issue" value={fmtInt(data.issues.total)} sub={`${fmtInt(data.issues.open)} mở · ${fmtInt(data.issues.done)} xong`} />
              <StatTile label="Tệp đính kèm" value={fmtInt(data.attachments.count)} sub={fmtBytes(data.attachments.totalBytes)} />
              <StatTile label="Hoạt động 24h" value={fmtInt(data.activity.last24h)} sub={`${fmtInt(data.activity.last7d)} trong 7 ngày`} />
            </div>
          </section>

          {/* AI 30 ngày */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink">AI · 30 ngày qua</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Lượt gọi" value={fmtInt(data.ai.requests)} accent />
              <StatTile label="Token vào / ra" value={`${fmtInt(data.ai.inputTokens)}`} sub={`${fmtInt(data.ai.outputTokens)} token ra`} />
              <StatTile label="Chi phí ước tính" value={`$${data.ai.estCostUsd.toFixed(2)}`} />
              <StatTile label="Tỉ lệ thành công" value={data.ai.successRate == null ? '—' : `${data.ai.successRate}%`} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
