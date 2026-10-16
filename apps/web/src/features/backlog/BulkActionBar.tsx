import { useEffect, type ReactNode } from 'react';
import { UserCheck, Users, MoveRight, X, Flag, Tag, Zap, CircleDot } from 'lucide-react';
import type { IssueDto, SprintDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { PeoplePicker } from '@/components/ui/PeoplePicker';
import { useAssigneePicker } from '@/features/issue-edit/useAssigneeOptions';
import { isOverlayOpen, shouldClearSelectionOnEscape } from '@/lib/hotkeys';
import { activeDrag } from '@/lib/activeDrag';
import { categoryColor } from '@/lib/statusColor';
import type { NextStatus } from '@/features/issues/nextStatuses';
import type { ProjectLabel } from '@/features/issue-meta/api';
import { PointsPopover } from './PointsPopover';
import type { PriorityChoice } from './InlineEdits';
import { cn } from '@/lib/utils';
import { TERM } from '@/lib/terms';

/** id ảo cho lựa chọn "Backlog" trong picker chuyển sprint (sprintId thực = null). */
const BACKLOG_OPTION = '__backlog__';
/** id ảo cho lựa chọn "Gỡ khỏi epic" / "Bỏ ưu tiên" (giá trị thật = null). */
const NONE_OPTION = '__none__';

/**
 * Esc bỏ chọn (ngay cả khi focus không nằm trên thanh này) — trừ khi Esc dành cho thứ khác: dialog/menu/popover đang mở
 * (kể cả popover của chính thanh này), kéo-thả bằng phím, hoặc một handler khác đã xử lý.
 */
function useEscapeClears(onClear: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Nghe ở `document` (trước `window` của panel xem nhanh): bỏ chọn xong thì preventDefault để panel không đóng theo.
      const fromPeek = !!(e.target as Element | null)?.closest?.('[data-peek-panel]');
      if (
        shouldClearSelectionOnEscape(e, isOverlayOpen(), {
          fromPeek,
          dragging: activeDrag.get() !== null,
        })
      ) {
        e.preventDefault();
        onClear();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClear]);
}

function AssignTrigger() {
  return (
    <span className="flex items-center gap-2 text-muted">
      <Users className="h-4 w-4 shrink-0" />
      Đổi người phụ trách
    </span>
  );
}

/**
 * Thanh thao tác hàng loạt (sticky đáy backlog) — hiện khi có ≥1 việc được chọn.
 * Các hành động ghi được gate ở phía trang gọi (canAssign / canManageBacklog).
 */
export function BulkActionBar({
  count,
  projectId,
  sprints,
  busy,
  canAssign,
  canManageBacklog,
  onAssignToMe,
  onAssignTo,
  onMoveToSprint,
  onClear,
  canEdit,
  canTransition,
  priorities,
  epics,
  labels,
  statusOptions,
  onSetPoints,
  onSetPriority,
  onAddLabel,
  onSetEpic,
  onSetStatus,
}: {
  count: number;
  projectId: string;
  sprints: SprintDto[];
  busy: boolean;
  canAssign: boolean;
  canManageBacklog: boolean;
  onAssignToMe: () => void;
  onAssignTo: (userId: string) => void;
  onMoveToSprint: (sprintId: string | null) => void;
  onClear: () => void;
  /** Sửa được MỌI việc đang chọn (`canEditIssue` từng việc) — cho Điểm/Ưu tiên/Nhãn/Epic. */
  canEdit: boolean;
  /** Có quyền chuyển trạng thái (`issue:transition`). */
  canTransition: boolean;
  priorities: PriorityChoice[];
  /** Epic chọn được (đã loại các việc đang chọn). */
  epics: IssueDto[];
  labels: ProjectLabel[];
  /** Trạng thái mà MỌI việc đang chọn đều chuyển tới được (`commonNextStatuses`). */
  statusOptions: NextStatus[];
  onSetPoints: (points: number | null) => void;
  onSetPriority: (priorityId: string | null) => void;
  onAddLabel: (labelId: string) => void;
  onSetEpic: (epicId: string | null) => void;
  onSetStatus: (statusId: string) => void;
}) {
  const assignPicker = useAssigneePicker(projectId);
  useEscapeClears(onClear);

  const sprintOptions = [
    { value: BACKLOG_OPTION, label: TERM.backlog },
    ...sprints.map((s) => ({ value: s.id, label: s.name })),
  ];

  return (
    <div
      role="region"
      aria-label="Thao tác hàng loạt"
      className={cn(
        'sticky bottom-0 z-sticky mx-6 mb-24 flex lg:mb-4 lg:mr-24 flex-wrap items-center gap-2 rounded-xl border border-border',
        'bg-surface/95 px-4 py-2.5 shadow-lg backdrop-blur',
        'animate-in fade-in slide-in-from-bottom-2 duration-200',
      )}
    >
      <span
        className="text-sm font-medium text-ink-strong"
        aria-live="polite"
        title="Các thao tác bên phải sẽ áp cho tất cả việc đang chọn. Nhấn Esc để bỏ chọn."
      >
        Đã chọn <span className="tabular">{count}</span> việc
      </span>

      {/* Mobile: MỘT hàng cuộn ngang thay vì xuống 5 dòng — thanh không che cả màn hình. */}
      <div className="flex items-center gap-2 max-sm:w-full max-sm:overflow-x-auto max-sm:pb-1 max-sm:[&>*]:shrink-0 sm:ml-auto sm:flex-wrap">
        {canAssign && (
          <>
            <Button
              size="sm"
              variant="secondary"
              title="Đặt bạn làm người phụ trách các việc đang chọn"
              loading={busy}
              onClick={onAssignToMe}
            >
              <UserCheck className="h-4 w-4" />
              Gán cho tôi
            </Button>

            <PeoplePicker
              value=""
              onChange={(v) => {
                if (v) onAssignTo(v);
              }}
              {...assignPicker}
              includeEmpty={false}
              ariaLabel="Chọn người phụ trách mới cho các việc đang chọn"
              disabled={busy || assignPicker.options.length === 0}
              align="end"
              className="h-8 w-52"
              renderTrigger={AssignTrigger}
            />
          </>
        )}

        {canManageBacklog && (
          <SearchSelect
            value=""
            onChange={(v) => {
              if (v) onMoveToSprint(v === BACKLOG_OPTION ? null : v);
            }}
            options={sprintOptions}
            placeholder="Chuyển sprint"
            searchPlaceholder="Tìm sprint…"
            ariaLabel="Chuyển các việc đang chọn sang một sprint khác hoặc về Việc chờ"
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

        <BulkEditControls
          busy={busy}
          canEdit={canEdit}
          canTransition={canTransition}
          priorities={priorities}
          epics={epics}
          labels={labels}
          statusOptions={statusOptions}
          onSetPoints={onSetPoints}
          onSetPriority={onSetPriority}
          onAddLabel={onAddLabel}
          onSetEpic={onSetEpic}
          onSetStatus={onSetStatus}
        />

        <Button
          size="sm"
          variant="ghost"
          title="Bỏ chọn tất cả · phím Esc"
          onClick={onClear}
          disabled={busy}
        >
          <X className="h-4 w-4" />
          Bỏ chọn
        </Button>
      </div>
    </div>
  );
}

/** Điểm / Ưu tiên / Nhãn / Epic / Trạng thái — các thao tác sửa hàng loạt thêm ở B8 (ẩn khi thiếu quyền, không để bấm rồi 403). */
function BulkEditControls({
  busy,
  canEdit,
  canTransition,
  priorities,
  epics,
  labels,
  statusOptions,
  onSetPoints,
  onSetPriority,
  onAddLabel,
  onSetEpic,
  onSetStatus,
}: Pick<
  Parameters<typeof BulkActionBar>[0],
  | 'busy'
  | 'canEdit'
  | 'canTransition'
  | 'priorities'
  | 'epics'
  | 'labels'
  | 'statusOptions'
  | 'onSetPoints'
  | 'onSetPriority'
  | 'onAddLabel'
  | 'onSetEpic'
  | 'onSetStatus'
>) {
  return (
    <>
      {canEdit && (
        <>
          <PointsPopover onApply={onSetPoints} disabled={busy} />
          <SearchSelect
            value=""
            onChange={(v) => onSetPriority(v === NONE_OPTION ? null : v)}
            options={[
              { value: NONE_OPTION, label: 'Bỏ ưu tiên' },
              ...priorities.map((p) => ({ value: p.id, label: p.name, color: p.color })),
            ]}
            placeholder="Ưu tiên"
            searchPlaceholder="Tìm mức ưu tiên…"
            ariaLabel="Đặt mức ưu tiên cho các việc đang chọn"
            disabled={busy || priorities.length === 0}
            align="end"
            className="h-8 w-auto"
            renderTrigger={() => (
              <BarTrigger icon={<Flag className="h-4 w-4 shrink-0" />} text="Ưu tiên" />
            )}
          />
          <SearchSelect
            value=""
            onChange={(v) => v && onAddLabel(v)}
            options={labels.map((l) => ({ value: l.id, label: l.name, color: l.color }))}
            placeholder="Nhãn"
            searchPlaceholder="Tìm nhãn…"
            ariaLabel="Gắn nhãn cho các việc đang chọn"
            disabled={busy || labels.length === 0}
            align="end"
            className="h-8 w-auto"
            renderTrigger={() => (
              <BarTrigger icon={<Tag className="h-4 w-4 shrink-0" />} text="Nhãn" />
            )}
          />
          <SearchSelect
            value=""
            onChange={(v) => v && onSetEpic(v === NONE_OPTION ? null : v)}
            options={[
              { value: NONE_OPTION, label: 'Gỡ khỏi epic' },
              ...epics.map((e) => ({ value: e.id, label: e.summary, hint: e.key })),
            ]}
            placeholder="Epic"
            searchPlaceholder="Tìm epic…"
            ariaLabel="Gắn các việc đang chọn vào một epic, hoặc gỡ khỏi epic"
            disabled={busy}
            align="end"
            className="h-8 w-auto"
            renderTrigger={() => (
              <BarTrigger icon={<Zap className="h-4 w-4 shrink-0" />} text="Epic" />
            )}
          />
        </>
      )}

      {canTransition && (
        <span
          className="inline-flex"
          title={
            statusOptions.length === 0 ? 'Các việc đang chọn không có bước chuyển chung' : undefined
          }
        >
          <SearchSelect
            value=""
            onChange={(v) => v && onSetStatus(v)}
            options={statusOptions.map((s) => ({
              value: s.id,
              label: s.name,
              color: categoryColor(s.category),
            }))}
            placeholder="Trạng thái"
            searchPlaceholder="Tìm trạng thái…"
            ariaLabel="Đổi trạng thái các việc đang chọn"
            disabled={busy || statusOptions.length === 0}
            align="end"
            className="h-8 w-auto"
            renderTrigger={() => (
              <BarTrigger icon={<CircleDot className="h-4 w-4 shrink-0" />} text="Trạng thái" />
            )}
          />
        </span>
      )}
    </>
  );
}

/** Nội dung trigger gọn của các ô chọn trên thanh (biểu tượng + chữ, mờ như các nút phụ). */
function BarTrigger({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="flex items-center gap-2 text-muted">
      {icon}
      {text}
    </span>
  );
}
