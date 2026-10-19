import { useEffect, useState, type ReactNode } from 'react';
import {
  UserCheck,
  Users,
  MoveRight,
  MoreHorizontal,
  X,
  Flag,
  Tag,
  Zap,
  CircleDot,
} from 'lucide-react';
import type { IssueDto, SprintDto } from '@tirapro/types';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { PeoplePicker } from '@/components/ui/PeoplePicker';
import { useAssigneePicker } from '@/features/issue-edit/useAssigneeOptions';
import { isOverlayOpen, isTypingTarget, shouldClearSelectionOnEscape } from '@/lib/hotkeys';
import { activeDrag } from '@/lib/activeDrag';
import { categoryColor } from '@/lib/statusColor';
import type { NextStatus } from '@/features/issues/nextStatuses';
import type { ProjectLabel } from '@/features/issue-meta/api';
import { PointsPopover } from '@/features/backlog/PointsPopover';
import type { PriorityChoice } from '@/features/backlog/InlineEdits';
import { cn } from '@/lib/utils';
import { TERM } from '@/lib/terms';
import { labelTone } from '@/lib/labelPalette';

/** id ảo cho lựa chọn "Backlog" trong picker chuyển sprint (sprintId thực = null). */
const BACKLOG_OPTION = '__backlog__';
/** id ảo cho lựa chọn "Gỡ khỏi epic" / "Bỏ ưu tiên" (giá trị thật = null). */
const NONE_OPTION = '__none__';
const NO_SPRINTS: SprintDto[] = [];
const NO_EPICS: IssueDto[] = [];

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
          typing: isTypingTarget(e.target),
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
 * Dock thao tác hàng loạt (Việc chờ, Bảng việc) — hiện khi có ≥1 việc được chọn. Thuần trình bày: các hành động ghi được
 * gate ở phía trang gọi (canAssign / canManageBacklog / canEdit / canTransition), và NHÓM KHÔNG TRUYỀN HANDLER = ẨN
 * (Bảng việc không có sprint/epic).
 */
export function BulkDock({
  count,
  projectId,
  sprints = NO_SPRINTS,
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
  placement = 'sticky',
}: {
  count: number;
  projectId: string;
  /** Sprint chọn được; chỉ dùng khi có `onMoveToSprint`. */
  sprints?: SprintDto[];
  busy: boolean;
  canAssign: boolean;
  canManageBacklog: boolean;
  onAssignToMe: () => void;
  onAssignTo: (userId: string) => void;
  /** Không truyền = ẩn nhóm "Chuyển sprint". */
  onMoveToSprint?: (sprintId: string | null) => void;
  onClear: () => void;
  /** Sửa được MỌI việc đang chọn (`canEditIssue` từng việc) — cho Điểm/Ưu tiên/Nhãn/Epic. */
  canEdit: boolean;
  /** Có quyền chuyển trạng thái (`issue:transition`). */
  canTransition: boolean;
  priorities: PriorityChoice[];
  /** Epic chọn được (đã loại các việc đang chọn); chỉ dùng khi có `onSetEpic`. */
  epics?: IssueDto[];
  labels: ProjectLabel[];
  /** Trạng thái mà MỌI việc đang chọn đều chuyển tới được (`commonNextStatuses`). */
  statusOptions: NextStatus[];
  onSetPoints: (points: number | null) => void;
  onSetPriority: (priorityId: string | null) => void;
  onAddLabel: (labelId: string) => void;
  /** Không truyền = ẩn nhóm "Epic". */
  onSetEpic?: (epicId: string | null) => void;
  onSetStatus: (statusId: string) => void;
  /**
   * `sticky` = dính đáy vùng cuộn của trang (Việc chờ). `docked` = con flex `shrink-0` ở cuối cột nội dung (Bảng việc: vùng
   * cuộn là từng cột nên không dính được), nằm trên thanh tab đáy.
   */
  placement?: 'sticky' | 'docked';
}) {
  useEscapeClears(onClear);
  const compact = useMediaQuery(COMPACT_QUERY);
  const [moreOpen, setMoreOpen] = useState(false);
  const edit = {
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
  };
  const assign = { busy, projectId, canAssign, onAssignToMe, onAssignTo };
  const sprint = { busy, sprints, canManage: canManageBacklog, onMove: onMoveToSprint };

  return (
    <div
      role="region"
      aria-label="Thao tác hàng loạt"
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 shadow-lg',
        'animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none',
        placement === 'sticky' ? STICKY_CLS : DOCKED_CLS,
        compact && 'flex-nowrap gap-1.5 px-3',
      )}
    >
      <span
        className="whitespace-nowrap text-sm font-medium text-ink-strong"
        aria-live="polite"
        title="Các thao tác bên phải sẽ áp cho tất cả việc đang chọn. Nhấn Esc để bỏ chọn."
      >
        Đã chọn <span className="tabular">{count}</span> việc
      </span>

      {compact ? (
        // Điện thoại: MỘT hàng — hành động chính (Trạng thái) + "…" mở sheet đáy chứa phần còn lại.
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          <BulkEditControls {...edit} only="status" layout="row" />
          <Button
            size="icon"
            variant="secondary"
            aria-label="Thêm thao tác"
            aria-haspopup="dialog"
            title="Thêm thao tác"
            disabled={busy}
            onClick={() => setMoreOpen(true)}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Bỏ chọn tất cả"
            title="Bỏ chọn tất cả · phím Esc"
            onClick={onClear}
            disabled={busy}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <AssignControls {...assign} layout="row" />
          <SprintControl {...sprint} layout="row" />
          <BulkEditControls {...edit} layout="row" />
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
      )}

      {compact && (
        <Dialog
          open={moreOpen}
          onOpenChange={setMoreOpen}
          title={`Thao tác cho ${count} việc đã chọn`}
          placement="bottom"
        >
          <div className="flex flex-col gap-2">
            <AssignControls {...assign} layout="stack" />
            <SprintControl {...sprint} layout="stack" />
            <BulkEditControls {...edit} only="rest" layout="stack" />
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** "Gán cho tôi" + "Đổi người phụ trách" (cùng quyền `canAssign`). */
function AssignControls({
  layout,
  busy,
  projectId,
  canAssign,
  onAssignToMe,
  onAssignTo,
}: {
  layout: Layout;
  busy: boolean;
  projectId: string;
  canAssign: boolean;
  onAssignToMe: () => void;
  onAssignTo: (userId: string) => void;
}) {
  const assignPicker = useAssigneePicker(projectId);
  if (!canAssign) return null;
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        title="Đặt bạn làm người phụ trách các việc đang chọn"
        loading={busy}
        onClick={onAssignToMe}
        className={layout === 'stack' ? 'h-11 w-full justify-start' : undefined}
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
        className={layout === 'stack' ? 'h-11 w-full' : 'h-8 w-52'}
        renderTrigger={AssignTrigger}
      />
    </>
  );
}

/** "Chuyển sprint" — chỉ khi trang truyền `onMove` và có quyền quản lý backlog. */
function SprintControl({
  layout,
  busy,
  sprints,
  canManage,
  onMove,
}: {
  layout: Layout;
  busy: boolean;
  sprints: SprintDto[];
  canManage: boolean;
  onMove?: (sprintId: string | null) => void;
}) {
  if (!canManage || !onMove) return null;
  const options = [
    { value: BACKLOG_OPTION, label: TERM.backlog },
    ...sprints.map((s) => ({ value: s.id, label: s.name })),
  ];
  return (
    <SearchSelect
      value=""
      onChange={(v) => {
        if (v) onMove(v === BACKLOG_OPTION ? null : v);
      }}
      options={options}
      placeholder="Chuyển sprint"
      searchPlaceholder="Tìm sprint…"
      ariaLabel="Chuyển các việc đang chọn sang một sprint khác hoặc về Việc chờ"
      disabled={busy}
      align="end"
      className={layout === 'stack' ? 'h-11 w-full' : 'h-8 w-48'}
      renderTrigger={() => (
        <span className="flex items-center gap-2 text-muted">
          <MoveRight className="h-4 w-4 shrink-0" />
          Chuyển sprint
        </span>
      )}
    />
  );
}

/**
 * Dính đáy vùng cuộn của trang (Việc chờ). Cha `space-y-4` ghi đè margin-bottom của con nên KHÔNG đặt mb-* ở đây
 * (lớp chết đã bỏ ở đợt 2A; có test canh).
 */
const STICKY_CLS = 'sticky bottom-0 z-sticky mx-6 lg:mr-24';
/**
 * Con flex của cột nội dung (không định vị cố định): nằm ngay trên thanh tab đáy (đã tính vùng an toàn), không che thẻ;
 * từ `lg` không có thanh tab nên tự chừa vùng an toàn của thiết bị.
 */
const DOCKED_CLS =
  'mx-3 mb-3 shrink-0 sm:mx-4 lg:mr-24 lg:mb-[max(0.75rem,env(safe-area-inset-bottom))]';

type Layout = 'row' | 'stack';
/** Dưới `sm` (640px): dock gọn một hàng + sheet "…". */
const COMPACT_QUERY = '(max-width: 639px)';

/** Điểm / Ưu tiên / Nhãn / Epic / Trạng thái. `only`: chỉ Trạng thái (hàng gọn trên điện thoại) hoặc phần còn lại (sheet). */
function BulkEditControls({
  busy,
  canEdit,
  canTransition,
  priorities,
  epics = NO_EPICS,
  labels,
  statusOptions,
  onSetPoints,
  onSetPriority,
  onAddLabel,
  onSetEpic,
  onSetStatus,
  only,
  layout,
}: Pick<
  Parameters<typeof BulkDock>[0],
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
> & { only?: 'status' | 'rest'; layout: Layout }) {
  const cls = layout === 'stack' ? 'h-11 w-full' : 'h-8 w-auto';
  return (
    <>
      {canEdit && only !== 'status' && (
        <>
          <PointsPopover
            onApply={onSetPoints}
            disabled={busy}
            triggerClassName={layout === 'stack' ? 'h-11 w-full justify-start' : undefined}
          />
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
            className={cls}
            renderTrigger={() => (
              <BarTrigger icon={<Flag className="h-4 w-4 shrink-0" />} text="Ưu tiên" />
            )}
          />
          <SearchSelect
            value=""
            onChange={(v) => v && onAddLabel(v)}
            options={labels.map((l) => ({
              value: l.id,
              label: l.name,
              color: labelTone(l.color).fg,
            }))}
            placeholder="Nhãn"
            searchPlaceholder="Tìm nhãn…"
            ariaLabel="Gắn nhãn cho các việc đang chọn"
            disabled={busy || labels.length === 0}
            align="end"
            className={cls}
            renderTrigger={() => (
              <BarTrigger icon={<Tag className="h-4 w-4 shrink-0" />} text="Nhãn" />
            )}
          />
          {onSetEpic && (
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
              className={cls}
              renderTrigger={() => (
                <BarTrigger icon={<Zap className="h-4 w-4 shrink-0" />} text="Epic" />
              )}
            />
          )}
        </>
      )}

      {canTransition && only !== 'rest' && (
        <span
          className={cn('inline-flex', layout === 'stack' && 'w-full')}
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
            className={cls}
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
