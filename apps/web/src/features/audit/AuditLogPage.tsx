import { useMemo, useState } from 'react';
import { ScrollText, ShieldOff } from 'lucide-react';
import { AUDIT_ACTION_LABEL, type AuditAction } from '@tirapro/types';
import { pageContainer } from '@/components/layout/page';
import { Avatar, Badge, EmptyState } from '@/components/ui/primitives';
import { Button } from '@/components/ui/Button';
import { DateInput } from '@/components/ui/DateInput';
import { QueryBoundary } from '@/components/ui/QueryBoundary';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { LOCALE } from '@/lib/locale';
import { useAuth } from '@/stores/auth';
import { useWorkspaceMembers } from '@/features/members/api';
import { relTime } from '@/features/admin/_ui';
import { useAuditLog } from './api';
import { toAuditQuery, type AuditFilterInput } from './auditFilters';

const EMPTY_FILTERS: AuditFilterInput = { action: '', actorId: '', from: '', to: '' };

/** Nhóm loại sự kiện theo tiền tố (`role.*`, `member.*`…) để `<select>` dễ quét. */
const ACTION_GROUPS: { label: string; prefixes: string[] }[] = [
  { label: 'Vai trò', prefixes: ['role.'] },
  { label: 'Thành viên', prefixes: ['member.'] },
  { label: 'Dự án', prefixes: ['project_member.', 'project.'] },
  { label: 'Tài khoản', prefixes: ['account.'] },
  { label: 'Tích hợp', prefixes: ['integration.'] },
];

const ACTIONS = Object.keys(AUDIT_ACTION_LABEL) as AuditAction[];

const SELECT_CLASS =
  'h-9 rounded-md border border-border bg-bg px-2 text-sm text-ink focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[var(--ring)]';

/** Thanh lọc: loại sự kiện, người thực hiện, khoảng ngày. */
function AuditFilterBar({
  filters,
  onChange,
  onClear,
  hasFilter,
}: {
  filters: AuditFilterInput;
  onChange: (patch: Partial<AuditFilterInput>) => void;
  onClear: () => void;
  hasFilter: boolean;
}) {
  const { data: members } = useWorkspaceMembers();
  const actorOptions = useMemo(
    () => [
      { value: '', label: 'Tất cả người thực hiện' },
      ...(members ?? []).map((m) => ({
        value: m.user.id,
        label: m.user.displayName,
        hint: m.user.email,
      })),
    ],
    [members],
  );
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-muted">
        Loại sự kiện
        <select
          value={filters.action}
          onChange={(e) => onChange({ action: e.target.value })}
          className={SELECT_CLASS}
        >
          <option value="">Tất cả sự kiện</option>
          {ACTION_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {ACTIONS.filter((a) => g.prefixes.some((p) => a.startsWith(p))).map((a) => (
                <option key={a} value={a}>
                  {AUDIT_ACTION_LABEL[a]}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="flex min-w-48 flex-col gap-1 text-xs text-muted">
        <span>Người thực hiện</span>
        <SearchSelect
          value={filters.actorId}
          onChange={(actorId) => onChange({ actorId })}
          options={actorOptions}
          ariaLabel="Người thực hiện"
          searchPlaceholder="Tìm người…"
        />
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Từ ngày
        <div className="w-40">
          <DateInput
            value={filters.from}
            max={filters.to || undefined}
            onChange={(iso) => onChange({ from: iso })}
          />
        </div>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Đến ngày
        <div className="w-40">
          <DateInput
            value={filters.to}
            min={filters.from || undefined}
            onChange={(iso) => onChange({ to: iso })}
          />
        </div>
      </label>
      {hasFilter && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Xoá bộ lọc
        </Button>
      )}
    </div>
  );
}

/** Cài đặt → Nhật ký quản trị: ai đã làm gì với vai trò, thành viên, tích hợp, tài khoản. Chỉ quản trị workspace. */
export function AuditLogPage() {
  const can = useAuth((s) => s.can);
  const allowed = can('workspace:admin');
  const [filters, setFilters] = useState<AuditFilterInput>(EMPTY_FILTERS);
  const query = useMemo(() => toAuditQuery(filters), [filters]);
  const log = useAuditLog(query, allowed);

  if (!allowed) {
    return (
      <div className={pageContainer('md')}>
        <EmptyState
          icon={<ShieldOff className="h-6 w-6" />}
          title="Bạn không có quyền xem nhật ký quản trị"
          description="Chỉ quản trị không gian làm việc xem được nhật ký này. Hãy nhờ quản trị viên nếu bạn cần tra cứu."
        />
      </div>
    );
  }

  const set = (patch: Partial<AuditFilterInput>) => setFilters((f) => ({ ...f, ...patch }));
  const hasFilter = Object.values(filters).some(Boolean);

  return (
    <div className={pageContainer('md')}>
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-strong">Nhật ký quản trị</h1>
        <p className="mt-1 text-sm text-muted">
          Ai đã thêm/gỡ thành viên, đổi vai trò, sửa tích hợp… trong không gian làm việc này.
        </p>
      </header>

      <AuditFilterBar
        filters={filters}
        onChange={set}
        onClear={() => setFilters(EMPTY_FILTERS)}
        hasFilter={hasFilter}
      />

      <QueryBoundary
        query={log}
        empty={(d) => d.pages.every((p) => p.data.length === 0)}
        emptyState={
          hasFilter ? (
            <EmptyState
              icon={<ScrollText className="h-6 w-6" />}
              title="Không có sự kiện nào khớp bộ lọc"
              description="Thử đổi loại sự kiện, người thực hiện hoặc khoảng ngày."
              action={
                <Button variant="secondary" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                  Xoá bộ lọc
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<ScrollText className="h-6 w-6" />}
              title="Chưa có sự kiện quản trị nào"
              description="Nhật ký ghi lại: tạo/sửa/xoá vai trò, thêm/gỡ thành viên, đổi vai trò, tạo hoặc xoá tích hợp, khoá/mở tài khoản."
            />
          )
        }
      >
        {(data) => (
          <>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
              {data.pages
                .flatMap((p) => p.data)
                .map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <Avatar name={e.actor?.displayName ?? '?'} src={e.actor?.avatarUrl} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="text-ink">
                        <span className="font-medium text-ink-strong">
                          {e.actor?.displayName ?? 'Hệ thống'}
                        </span>{' '}
                        <span className="text-muted">{e.summary}</span>
                      </p>
                      <Badge className="mt-1 text-faint">
                        {AUDIT_ACTION_LABEL[e.action] ?? e.action}
                      </Badge>
                    </div>
                    <time
                      className="shrink-0 text-xs text-faint"
                      dateTime={e.createdAt}
                      title={new Date(e.createdAt).toLocaleString(LOCALE, {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    >
                      {relTime(e.createdAt)}
                    </time>
                  </li>
                ))}
            </ul>
            {log.hasNextPage && (
              <div className="mt-3 flex justify-center">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void log.fetchNextPage()}
                  loading={log.isFetchingNextPage}
                >
                  Tải thêm
                </Button>
              </div>
            )}
          </>
        )}
      </QueryBoundary>
    </div>
  );
}
