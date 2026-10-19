import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GripVertical, LayoutDashboard, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { ProjectDto, TeamDto } from '@tirapro/types';
import type { CustomDashboardDto, CustomWidgetDto, DashboardWidgetType } from '@tirapro/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/primitives';
import { pageContainer } from '@/components/layout/page';
import { useProjects } from '@/features/projects/api';
import { useTeams } from '@/features/teams/api';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { useLeaveGuard } from '@/lib/useLeaveGuard';
import { isOverlayOpen, isTypingTarget, shouldLeaveEditorOnEscape } from '@/lib/hotkeys';
import { useSaveDashboard } from './api';
import { AddWidgetDialog } from './AddWidgetDialog';
import {
  addWidget,
  canAddWidget,
  draftIssues,
  insertWidget,
  isDirty,
  moveWidget,
  normalizeOrder,
  removeWidget,
  resizeWidget,
  shareValidation,
  toDashboardBody,
  updateWidget,
  newClientId,
  type DashboardDraft,
  type DraftWidget,
} from './layoutOps';
import { widgetDefOf } from './registry';
import { ShareDialog, type ShareValue } from './ShareDialog';
import { WidgetConfigDialog } from './WidgetConfigDialog';
import { SortableGrid } from './SortableGrid';
import { httpStatusOf } from './widgetState';

const NEW_DASHBOARD_NAME = 'Bảng tổng quan mới';

const SCOPE_LABEL = {
  PRIVATE: 'Chỉ mình tôi',
  GLOBAL: 'Cả không gian làm việc',
  PROJECT: 'Thành viên dự án',
  TEAM: 'Thành viên nhóm',
} as const;

function draftFromDashboard(d: CustomDashboardDto | null): DashboardDraft {
  if (!d) {
    return {
      name: NEW_DASHBOARD_NAME,
      description: '',
      scope: 'PRIVATE',
      projectId: '',
      teamId: '',
      widgets: [],
    };
  }
  const widgets: DraftWidget[] = d.widgets.map((w: CustomWidgetDto) => ({
    id: w.id,
    type: w.type,
    title: w.title,
    config: w.config,
    position: w.position,
  }));
  return {
    name: d.name,
    description: d.description ?? '',
    scope: d.scope,
    projectId: d.project?.id ?? '',
    teamId: d.team?.id ?? '',
    widgets: normalizeOrder(widgets),
  };
}

/** Lưu bản nháp: tạo mới (POST) hoặc ghi đè (PUT kèm `updatedAt` đã đọc). 409 → báo "vừa được người khác sửa" + Tải lại. */
function useSaveDraft({
  draft,
  dashboard,
  canSave,
  exitingRef,
  onReload,
}: {
  draft: DashboardDraft;
  dashboard: CustomDashboardDto | null;
  canSave: boolean;
  exitingRef: { current: boolean };
  onReload?: () => void;
}) {
  const navigate = useNavigate();
  const save = useSaveDashboard();
  const doSave = useCallback(async () => {
    if (!canSave || save.isPending) return;
    const body = toDashboardBody(draft);
    try {
      const dto = dashboard
        ? await save.mutateAsync({
            id: dashboard.id,
            body: { ...body, updatedAt: dashboard.updatedAt },
          })
        : await save.mutateAsync({ body });
      exitingRef.current = true;
      toast.success('Đã lưu bảng tổng quan');
      navigate(`/dashboards/${dto.id}`, { replace: true });
    } catch (err) {
      const message = apiErrorMessage(err); // đánh dấu đã báo → toast chung không báo lần hai
      if (httpStatusOf(err) === 409 || apiErrorCode(err) === 'VERSION_CONFLICT') {
        toast.error('Bảng tổng quan vừa được người khác sửa', {
          duration: 10_000,
          action: onReload ? { label: 'Tải lại', onClick: onReload } : undefined,
        });
      } else {
        toast.error(message);
      }
    }
  }, [canSave, draft, dashboard, save, navigate, exitingRef, onReload]);
  return { doSave, saving: save.isPending };
}

/** Esc huỷ soạn (không khi đang gõ / đang kéo / có hộp mở), Cmd/Ctrl+S lưu. */
function useEditorHotkeys({
  onSave,
  onLeave,
  draggingRef,
}: {
  onSave: () => Promise<void>;
  onLeave: () => void;
  draggingRef: { current: boolean };
}): void {
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const leaveRef = useRef(onLeave);
  leaveRef.current = onLeave;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const leaving = shouldLeaveEditorOnEscape(e, {
          typing: isTypingTarget(e.target),
          overlayOpen: isOverlayOpen(),
          dragging: draggingRef.current,
        });
        if (leaving) leaveRef.current();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        // Hộp cấu hình/chia sẻ đang mở: thay đổi trong hộp chưa áp dụng, lưu lúc này sẽ bỏ sót chúng.
        if (!isOverlayOpen()) void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draggingRef]);
}

/** Tên dự án (mã) / nhóm đang được chọn để chia sẻ — hiện cạnh nhãn mức trên thanh công cụ. */
function shareTargetName(
  d: DashboardDraft,
  projects: ProjectDto[] | undefined,
  teams: TeamDto[] | undefined,
): string | undefined {
  if (d.scope === 'PROJECT') return projects?.find((p) => p.id === d.projectId)?.key;
  if (d.scope === 'TEAM') return teams?.find((t) => t.id === d.teamId)?.name;
  return undefined;
}

function NameFields({
  name,
  description,
  nameOk,
  onChange,
}: {
  name: string;
  description: string;
  nameOk: boolean;
  onChange: (p: { name?: string; description?: string }) => void;
}) {
  return (
    <div className="mb-4 flex flex-col gap-2">
      <Input
        aria-label="Tên bảng tổng quan"
        value={name}
        maxLength={120}
        onChange={(e) => onChange({ name: e.target.value })}
        aria-invalid={!nameOk || undefined}
        className="h-10 max-w-xl text-xl font-semibold tracking-tight"
      />
      <Input
        aria-label="Mô tả bảng tổng quan"
        value={description}
        maxLength={500}
        placeholder="Mô tả ngắn (không bắt buộc)"
        onChange={(e) => onChange({ description: e.target.value })}
        className="max-w-xl text-sm"
      />
    </div>
  );
}

function EditorToolbar({
  shareLabel,
  canAdd,
  canSave,
  saving,
  onShare,
  onAdd,
  onCancel,
  onSave,
}: {
  shareLabel: string;
  canAdd: boolean;
  canSave: boolean;
  saving: boolean;
  onShare: () => void;
  onAdd: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" onClick={onShare}>
        <Users className="h-4 w-4" aria-hidden />
        Ai xem: {shareLabel}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={onAdd}
        disabled={!canAdd}
        title={canAdd ? undefined : 'Đã đủ số ô tối đa của một bảng tổng quan'}
      >
        <Plus className="h-4 w-4" aria-hidden /> Thêm widget
      </Button>
      <span className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Huỷ
        </Button>
        <Button size="sm" onClick={onSave} loading={saving} disabled={!canSave}>
          Lưu
        </Button>
      </span>
    </div>
  );
}

/**
 * Chế độ soạn dashboard (`?edit=1` hoặc `/dashboards/new`): kéo thả đổi thứ tự (chuột, cảm ứng, bàn phím), đổi cỡ S/M/L,
 * thêm từ danh mục, gỡ có Hoàn tác, chọn mức chia sẻ. Mọi thay đổi chỉ gửi khi bấm Lưu; rời trang khi còn thay đổi chưa
 * lưu thì hỏi lại. `dashboard = null` là dashboard mới (chưa có trên máy chủ).
 */
export function DashboardEditor({
  dashboard,
  onReload,
}: {
  dashboard: CustomDashboardDto | null;
  /** Nạp lại bản mới nhất từ máy chủ (khi lưu đè bị 409). */
  onReload?: () => void;
}) {
  const navigate = useNavigate();
  const { data: projects } = useProjects();
  const { data: teams } = useTeams();

  const [saved] = useState(() => draftFromDashboard(dashboard));
  const [draft, setDraft] = useState<DashboardDraft>(saved);
  const [addOpen, setAddOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [configId, setConfigId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const widgets = useMemo(() => normalizeOrder(draft.widgets), [draft.widgets]);
  const patch = useCallback(
    (fn: (list: DraftWidget[]) => DraftWidget[]) =>
      setDraft((d) => ({ ...d, widgets: fn(d.widgets) })),
    [],
  );

  const dirty = isDirty(saved, draft);
  const issues = useMemo(() => draftIssues(widgets), [widgets]);
  const shareError = shareValidation(draft.scope, draft.projectId, draft.teamId);
  const nameOk = draft.name.trim().length > 0;
  const canSave =
    (dashboard === null || dirty) &&
    nameOk &&
    shareError === null &&
    Object.keys(issues).length === 0;

  const exitingRef = useRef(false);
  const draggingRef = useRef(false);
  draggingRef.current = dragging;
  const removeToastsRef = useRef(new Set<string | number>());

  const viewUrl = dashboard ? `/dashboards/${dashboard.id}` : '/';
  const leave = () => navigate(viewUrl, { replace: true });

  useLeaveGuard({
    dirty,
    shouldBlock: () => !exitingRef.current,
    description: 'Bảng tổng quan có thay đổi chưa lưu. Rời trang bây giờ sẽ mất chúng.',
  });
  useEffect(
    () => () => {
      removeToastsRef.current.forEach((id) => toast.dismiss(id));
    },
    [],
  );

  const { doSave, saving } = useSaveDraft({ draft, dashboard, canSave, exitingRef, onReload });

  useEditorHotkeys({ onSave: doSave, onLeave: leave, draggingRef });

  /* ---- Thao tác trên ô ---- */
  function onAdd(type: DashboardWidgetType) {
    const id = newClientId();
    patch((l) => addWidget(l, type, () => id));
    // Loại bắt buộc chọn dự án: mở luôn hộp cấu hình để không để ô "treo".
    if (widgetDefOf(type)?.project === 'required') setConfigId(id);
  }

  function onRemove(widget: DraftWidget) {
    const index = widgets.findIndex((w) => w.id === widget.id);
    patch((l) => removeWidget(l, widget.id));
    // Mỗi lần gỡ có toast Hoàn tác riêng (gỡ A rồi B trong 6 giây vẫn hoàn tác được cả hai).
    const toastId = toast('Đã gỡ widget', {
      duration: 6000,
      action: {
        label: 'Hoàn tác',
        onClick: () => patch((l) => insertWidget(l, widget, index)),
      },
    });
    removeToastsRef.current.add(toastId);
  }

  const share: ShareValue = {
    scope: draft.scope,
    projectId: draft.projectId,
    teamId: draft.teamId,
  };
  const shareName = shareTargetName(draft, projects, teams);
  const configWidget = widgets.find((w) => w.id === configId) ?? null;

  return (
    <div className={pageContainer('xl', 'py-6')}>
      <NameFields
        name={draft.name}
        description={draft.description}
        nameOk={nameOk}
        onChange={(p) => setDraft((d) => ({ ...d, ...p }))}
      />

      <EditorToolbar
        shareLabel={`${SCOPE_LABEL[draft.scope]}${shareName ? ` · ${shareName}` : ''}`}
        canAdd={canAddWidget(widgets)}
        canSave={canSave}
        saving={saving}
        onShare={() => setShareOpen(true)}
        onAdd={() => setAddOpen(true)}
        onCancel={leave}
        onSave={() => void doSave()}
      />
      <p className="mb-4 text-xs text-muted">
        Kéo tay nắm <GripVertical className="inline h-3.5 w-3.5" aria-hidden /> để đổi chỗ.
        <span className="kbd-hint">
          {' '}
          Bằng bàn phím: Tab tới tay nắm, Space nhấc, phím mũi tên di chuyển, Space thả. Esc để huỷ
          soạn, Ctrl/Cmd+S để lưu.
        </span>
      </p>
      {shareError && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {shareError}
        </p>
      )}

      {widgets.length === 0 ? (
        <EmptyState
          icon={<LayoutDashboard className="h-8 w-8" />}
          title="Bảng tổng quan trống — thêm widget đầu tiên"
          description="Chọn ô số liệu, biểu đồ hay danh sách việc từ danh mục."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Thêm widget
            </Button>
          }
        />
      ) : (
        <SortableGrid
          widgets={widgets}
          issues={issues}
          onMove={(activeId, overId) => patch((l) => moveWidget(l, activeId, overId))}
          onDraggingChange={setDragging}
          onResize={(id, w) => patch((l) => resizeWidget(l, id, w))}
          onConfig={setConfigId}
          onRemove={onRemove}
        />
      )}

      <AddWidgetDialog open={addOpen} onOpenChange={setAddOpen} onAdd={onAdd} />
      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        value={share}
        onApply={(v) => setDraft((d) => ({ ...d, ...v }))}
      />
      <WidgetConfigDialog
        widget={configWidget}
        onClose={() => setConfigId(null)}
        onSave={(id, p) => {
          patch((l) => updateWidget(l, id, p));
          setConfigId(null);
        }}
      />
    </div>
  );
}
