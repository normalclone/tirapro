import { useRef, useState, type KeyboardEvent } from 'react';
import { ScrollText } from 'lucide-react';
import { pageContainer } from '@/components/layout/page';
import { Avatar, Badge, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { QueryError } from '@/components/ui/QueryError';
import { cn } from '@/lib/utils';
import { groupedAuditActionOptions } from '@/features/audit/auditFilters';
import { useAdminAudit, useAdminHealth, type AuditKind } from './api';
import { StatTile, StatusPill, relTime } from './_ui';
import { fmtDateTime } from '@/lib/dateFormat';
import { SearchSelect } from '@/components/ui/SearchSelect';

/** Bậc số lượng nhật ký tải mỗi lần. */
const AUDIT_STEPS = [50, 100, 200] as const;

/** Hai nhật ký: sự kiện quản trị (mặc định) và hoạt động công việc (hành vi cũ của trang này). */
const AUDIT_TABS: { kind: AuditKind; label: string }[] = [
  { kind: 'admin', label: 'Quản trị' },
  { kind: 'activity', label: 'Hoạt động công việc' },
];

/** Các loại hành động công việc thường gặp để lọc nhanh (backend nhận `action` bất kỳ). */
const ACTIVITY_ACTIONS: { value: string; label: string; group?: string }[] = [
  { value: '', label: 'Tất cả hành động' },
  { value: 'CREATE', label: 'Tạo' },
  { value: 'UPDATE', label: 'Cập nhật' },
  { value: 'DELETE', label: 'Xoá' },
  { value: 'TRANSITION', label: 'Chuyển trạng thái' },
  { value: 'COMMENT', label: 'Bình luận' },
];

/** Loại sự kiện quản trị để lọc (nhãn tiếng Việt từ `AUDIT_ACTION_LABEL`). */
const ADMIN_ACTIONS = groupedAuditActionOptions('Tất cả sự kiện');

const fmtUptime = (s: number) => {
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600),
    m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}n ${h}g`;
  if (h > 0) return `${h}g ${m}p`;
  return `${m}p`;
};

const prettyAction = (a: string) => a.replace(/_/g, ' ').toLowerCase();

/** Tabs loại nhật ký theo mẫu ARIA: roving tabindex, mũi tên trái/phải + Home/End, aria-controls tới tabpanel. */
function AuditTabs({ kind, onChange }: { kind: AuditKind; onChange: (k: AuditKind) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = AUDIT_TABS.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : e.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    const target = AUDIT_TABS[next]!;
    onChange(target.kind);
    refs.current[target.kind]?.focus();
  }
  return (
    <div
      role="tablist"
      aria-label="Loại nhật ký"
      className="flex rounded-md border border-border bg-surface p-0.5"
    >
      {AUDIT_TABS.map((t, i) => (
        <button
          key={t.kind}
          ref={(el) => {
            refs.current[t.kind] = el;
          }}
          type="button"
          role="tab"
          id={`audit-tab-${t.kind}`}
          aria-selected={kind === t.kind}
          aria-controls="audit-tabpanel"
          tabIndex={kind === t.kind ? 0 : -1}
          onClick={() => onChange(t.kind)}
          onKeyDown={(e) => onKeyDown(e, i)}
          className={cn(
            'rounded px-3 py-1 text-xs font-medium transition-colors',
            kind === t.kind ? 'bg-primary-subtle text-primary' : 'text-muted hover:text-ink',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function AdminSystemPage() {
  const [limit, setLimit] = useState<number>(AUDIT_STEPS[0]);
  const [action, setAction] = useState('');
  const [kind, setKind] = useState<AuditKind>('admin');
  const actionOptions = kind === 'admin' ? ADMIN_ACTIONS : ACTIVITY_ACTIONS;
  const {
    data: health,
    isLoading: hLoading,
    isError: hError,
    error: hErr,
    refetch: hRefetch,
  } = useAdminHealth();
  const {
    data: audit,
    isLoading: aLoading,
    isError: aError,
    error: aErr,
    refetch: aRefetch,
    isFetching: aFetching,
  } = useAdminAudit(limit, action || undefined, kind);

  // Còn nữa để tải nếu số dòng trả về vừa đúng limit và chưa chạm bậc cao nhất.
  const canLoadMore = (audit?.length ?? 0) >= limit && limit < AUDIT_STEPS[AUDIT_STEPS.length - 1]!;
  const nextLimit = AUDIT_STEPS.find((s) => s > limit) ?? limit;

  return (
    <div className={pageContainer('lg')}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Hệ thống</h1>
        <p className="mt-1 text-sm text-muted">
          Tình trạng dịch vụ (tự làm mới) &amp; nhật ký kiểm toán toàn hệ thống.
        </p>
      </header>

      {/* Health */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-ink">Tình trạng dịch vụ</h2>
        {hError ? (
          <QueryError error={hErr} onRetry={() => void hRefetch()} />
        ) : hLoading || !health ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              <StatusPill
                tone={health.db ? 'ok' : 'down'}
                label="Database"
                note={
                  health.db
                    ? health.dbLatencyMs != null
                      ? `${health.dbLatencyMs}ms`
                      : 'ok'
                    : 'lỗi'
                }
              />
              <StatusPill
                tone={health.redis ? 'ok' : health.redisConfigured ? 'down' : 'warn'}
                label="Redis"
                note={
                  health.redis ? 'ok' : health.redisConfigured ? 'mất kết nối' : 'không cấu hình'
                }
              />
              <StatusPill
                tone={health.ai ? 'ok' : 'warn'}
                label="AI"
                note={health.ai ? 'bật' : 'heuristic'}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Uptime" value={fmtUptime(health.uptimeSec)} />
              <StatTile
                label="RAM (RSS)"
                value={`${health.memoryRssMb} MB`}
                sub={`heap ${health.heapUsedMb} MB`}
              />
              <StatTile label="Phiên bản" value={health.release} />
              <StatTile label="Môi trường" value={health.nodeEnv} />
            </div>
          </>
        )}
      </section>

      {/* Audit log */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Nhật ký kiểm toán · gần đây</h2>
          <AuditTabs
            kind={kind}
            onChange={(k) => {
              setKind(k);
              setAction('');
              setLimit(AUDIT_STEPS[0]);
            }}
          />
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>Lọc</span>
            <SearchSelect
              value={action}
              onChange={(v) => {
                setAction(v);
                setLimit(AUDIT_STEPS[0]);
              }}
              options={actionOptions}
              ariaLabel="Lọc nhật ký theo loại sự kiện"
              searchPlaceholder="Tìm sự kiện…"
              align="end"
              className="h-8 w-56 text-xs"
            />
          </div>
        </div>
        <div role="tabpanel" id="audit-tabpanel" aria-labelledby={`audit-tab-${kind}`}>
          {aError ? (
            <QueryError error={aErr} onRetry={() => void aRefetch()} />
          ) : aLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !audit || audit.length === 0 ? (
            <EmptyState
              icon={<ScrollText className="h-6 w-6" />}
              title="Chưa có nhật ký"
              description={
                kind === 'admin'
                  ? 'Nhật ký ghi lại các thao tác quản trị: tạo/sửa/xoá vai trò, thêm/gỡ thành viên, đổi vai trò, tích hợp, khoá/mở tài khoản.'
                  : 'Nhật ký ghi lại ai đã làm gì trên công việc. Khi có người tạo/sửa công việc hay chuyển trạng thái, các thao tác đó sẽ hiện ở đây.'
              }
            />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
              {audit.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <Avatar name={e.actor?.displayName ?? '?'} src={e.actor?.avatarUrl} size={26} />
                  <div className="min-w-0 flex-1">
                    <span className="text-ink">{e.actor?.displayName ?? 'Hệ thống'}</span>
                    {e.summary ? (
                      <span className="ml-2 text-muted">{e.summary}</span>
                    ) : (
                      <>
                        <Badge className="ml-2 text-muted">{prettyAction(e.action)}</Badge>
                        <span className="ml-2 text-muted">{e.entityType}</span>
                        {e.field && <span className="ml-1 text-faint">· {e.field}</span>}
                      </>
                    )}
                  </div>
                  {e.workspace && (
                    <span className="hidden shrink-0 text-xs text-faint sm:block">
                      {e.workspace.name}
                    </span>
                  )}
                  <time className="shrink-0 text-xs text-faint" title={fmtDateTime(e.createdAt)}>
                    {relTime(e.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
          {!aError && audit && audit.length > 0 && canLoadMore && (
            <div className="mt-3 flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setLimit(nextLimit)}
                loading={aFetching}
              >
                Tải thêm ({nextLimit})
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
