import { useEffect } from 'react';
import { UserCheck, Users, MoveRight, X } from 'lucide-react';
import type { SprintDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { PeoplePicker, type PersonOption } from '@/components/ui/PeoplePicker';
import { cn } from '@/lib/utils';

/** id ảo cho lựa chọn "Backlog" trong picker chuyển sprint (sprintId thực = null). */
export const BACKLOG_OPTION = '__backlog__';

/**
 * Thanh thao tác hàng loạt (sticky đáy backlog) — hiện khi có ≥1 việc được chọn.
 * Các hành động ghi được gate ở phía trang gọi (canAssign / canManageBacklog).
 */
export function BulkActionBar({
  count,
  assigneeOptions,
  sprints,
  busy,
  canAssign,
  canManageBacklog,
  onAssignToMe,
  onAssignTo,
  onMoveToSprint,
  onClear,
}: {
  count: number;
  assigneeOptions: PersonOption[];
  sprints: SprintDto[];
  busy: boolean;
  canAssign: boolean;
  canManageBacklog: boolean;
  onAssignToMe: () => void;
  onAssignTo: (userId: string) => void;
  onMoveToSprint: (sprintId: string | null) => void;
  onClear: () => void;
}) {
  // Esc bỏ chọn (ngay cả khi focus không nằm trên thanh này).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClear();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClear]);

  const sprintOptions = [
    { value: BACKLOG_OPTION, label: 'Backlog' },
    ...sprints.map((s) => ({ value: s.id, label: s.name })),
  ];

  return (
    <div
      role="region"
      aria-label="Thao tác hàng loạt"
      className={cn(
        'sticky bottom-0 z-sticky mx-6 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border',
        'bg-surface/95 px-4 py-2.5 shadow-lg backdrop-blur',
        'animate-in fade-in slide-in-from-bottom-2 duration-200',
      )}
    >
      <span className="text-sm font-medium text-ink-strong" aria-live="polite">
        Đã chọn <span className="tabular">{count}</span> việc
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {canAssign && (
          <>
            <Button size="sm" variant="secondary" loading={busy} onClick={onAssignToMe}>
              <UserCheck className="h-4 w-4" />
              Gán cho tôi
            </Button>

            <PeoplePicker
              value=""
              onChange={(v) => { if (v) onAssignTo(v); }}
              options={assigneeOptions}
              includeEmpty={false}
              ariaLabel="Đổi người phụ trách cho các việc đã chọn"
              disabled={busy || assigneeOptions.length === 0}
              align="end"
              className="h-8 w-52"
              renderTrigger={() => (
                <span className="flex items-center gap-2 text-muted">
                  <Users className="h-4 w-4 shrink-0" />
                  Đổi người phụ trách
                </span>
              )}
            />
          </>
        )}

        {canManageBacklog && (
          <SearchSelect
            value=""
            onChange={(v) => { if (v) onMoveToSprint(v === BACKLOG_OPTION ? null : v); }}
            options={sprintOptions}
            placeholder="Chuyển sprint"
            searchPlaceholder="Tìm sprint…"
            ariaLabel="Chuyển các việc đã chọn sang sprint"
            disabled={busy}
            align="end"
            className="h-8 w-48"
            renderTrigger={() => (
              <span className="flex items-center gap-2 text-muted">
                <MoveRight className="h-4 w-4 shrink-0" />
                Chuyển sprint
              </span>
            )}
          />
        )}

        <Button size="sm" variant="ghost" onClick={onClear} disabled={busy}>
          <X className="h-4 w-4" />
          Bỏ chọn
        </Button>
      </div>
    </div>
  );
}
