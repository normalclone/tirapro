import { RefreshCw } from 'lucide-react';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/primitives';
import { QueryError } from '@/components/ui/QueryError';
import { useAdminOverview } from './api';
import { StatTile, StatusPill, fmtBytes, relTime } from './_ui';
import { fmtNumber } from '@/lib/locale';
import { ADMIN_LABELS } from '@/lib/navLabels';

export function AdminOverviewPage() {
  const { data, isLoading, isError, error, isFetching, refetch } = useAdminOverview();
  // Nút chỉ có biểu tượng: nhãn + thời điểm cập nhật nằm ở tooltip (và tên truy cập).
  const refreshLabel = data ? `Làm mới · ${relTime(data.generatedAt)}` : 'Làm mới';

  return (
    <PageFrame size="lg">
      <PageHeader
        title={ADMIN_LABELS.overview}
        description="Sức khoẻ & quy mô toàn hệ thống, cập nhật tự động."
        actions={
          <Button
            variant="outline"
            size="icon"
            onClick={() => void refetch()}
            title={refreshLabel}
            aria-label={refreshLabel}
          >
            <RefreshCw className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        }
      />

      {isError ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-11 w-full" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Trạng thái dịch vụ (degrade-graceful) */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink">Trạng thái dịch vụ</h2>
            <div className="flex flex-wrap gap-2">
              <StatusPill
                tone={data.degrade.db ? 'ok' : 'down'}
                label="Cơ sở dữ liệu"
                note={data.degrade.db ? 'hoạt động' : 'mất kết nối'}
              />
              <StatusPill
                tone={data.degrade.redis ? 'ok' : 'warn'}
                label="Redis"
                note={data.degrade.redis ? 'hoạt động' : 'giảm cấp'}
              />
              <StatusPill
                tone={data.degrade.ai ? 'ok' : 'warn'}
                label="AI"
                note={
                  data.degrade.ai
                    ? 'bật'
                    : data.degrade.aiConfigured
                      ? 'tắt (kill-switch)'
                      : 'heuristic'
                }
              />
              <StatusPill
                tone={data.degrade.embedding ? 'ok' : 'warn'}
                label="Embedding"
                note={data.degrade.embedding ? data.degrade.embeddingProvider : 'full-text'}
              />
              <StatusPill
                tone={data.degrade.storage ? 'ok' : 'down'}
                label="Lưu trữ"
                note={data.degrade.storageDriver}
              />
            </div>
          </section>

          {/* Quy mô nội dung */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink">Quy mô</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <StatTile
                label="Không gian làm việc"
                value={fmtNumber(data.workspaces.active)}
                sub={
                  data.workspaces.archived > 0
                    ? `${fmtNumber(data.workspaces.archived)} đã lưu trữ`
                    : 'chưa có nơi nào lưu trữ'
                }
              />
              <StatTile
                label="Người dùng"
                value={fmtNumber(data.users.active)}
                sub={`${fmtNumber(data.users.systemAdmins)} admin · ${fmtNumber(data.users.deactivated)} vô hiệu`}
              />
              <StatTile label="Dự án" value={fmtNumber(data.projects)} />
              <StatTile
                label="Công việc"
                value={fmtNumber(data.issues.total)}
                sub={`${fmtNumber(data.issues.open)} đang mở · ${fmtNumber(data.issues.done)} đã xong`}
              />
              <StatTile
                label="Tệp đính kèm"
                value={fmtNumber(data.attachments.count)}
                sub={fmtBytes(data.attachments.totalBytes)}
              />
              <StatTile
                label="Hoạt động 24h"
                value={fmtNumber(data.activity.last24h)}
                sub={`${fmtNumber(data.activity.last7d)} trong 7 ngày`}
              />
            </div>
          </section>

          {/* AI 30 ngày */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink">AI · 30 ngày qua</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Lượt gọi" value={fmtNumber(data.ai.requests)} accent />
              <StatTile
                label="Token vào / ra"
                value={`${fmtNumber(data.ai.inputTokens)}`}
                sub={`${fmtNumber(data.ai.outputTokens)} token ra`}
              />
              <StatTile label="Chi phí ước tính" value={`$${data.ai.estCostUsd.toFixed(2)}`} />
              <StatTile
                label="Tỉ lệ thành công"
                value={data.ai.successRate == null ? '—' : `${data.ai.successRate}%`}
              />
            </div>
          </section>
        </div>
      )}
    </PageFrame>
  );
}
