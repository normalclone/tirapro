import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, GripVertical, LayoutDashboard, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { ProjectDto, TeamDto } from '@tirapro/types';
import type { CustomDashboardDto, CustomWidgetDto, DashboardWidgetType } from '@tirapro/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/primitives';
import { PageFrame } from '@/components/layout/PageFrame';
import { PageHeader } from '@/components/layout/PageHeader';
import { useProjects } from '@/features/projects/api';
import { useTeams } from '@/features/teams/api';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { dashboardUrl } from '@/lib/copyText';
import { useLeaveGuard } from '@/lib/useLeaveGuard';
import { isOverlayOpen, isTypingTarget, shouldLeaveEditorOnEscape } from '@/lib/hotkeys';
import { useSaveDashboard } from './api';
import { DataScopeDialog } from './scope/DataScopeDialog';
import { DashboardScopeProvider } from './scope/ScopedWidget';
import { DATA_SCOPE_LABEL, dataScopeIssue, scopeValueOf } from './scope/dataScopeModel';
import { dataScopeSummary, scopeInfoOf } from './scope/widgetScope';
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
  GLOBAL: 'Cả tổ chức',
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

/** Liên kết sao chép của hộp chia sẻ: chỉ khi bảng đã lưu (có id); `saved` = mức chia sẻ đang lưu thật. */
function shareLinkOf(
  dashboard: CustomDashboardDto | null,
  saved: ShareValue,
): { url: string; saved: ShareValue } | undefined {
  if (!dashboard) return undefined;
  return { url: dashboardUrl(dashboard.id), saved: pickShare(saved) };
}

const pickShare = (d: ShareValue): ShareValue => ({
  scope: d.scope,
  projectId: d.projectId,
  teamId: d.teamId,
});

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

type DialogKey = 'add' | 'share' | 'data';

/** Bốn hộp thoại của trình soạn (thêm ô, chia sẻ, phạm vi dữ liệu, cấu hình ô); luôn mount, mở bằng `open`. */
function EditorDialogs({
  dashboard,
  saved,
  draft,
  open,
  setOpen,
  configWidget,
  onCloseConfig,
  onAdd,
  onDraft,
  onSaveConfig,
}: {
  dashboard: CustomDashboardDto | null;
  saved: DashboardDraft;
  draft: DashboardDraft;
  open: Record<DialogKey, boolean>;
  setOpen: Record<DialogKey, (open: boolean) => void>;
  configWidget: DraftWidget | null;
  onCloseConfig: () => void;
  onAdd: (type: DashboardWidgetType) => void;
  onDraft: (fn: (d: DashboardDraft) => DashboardDraft) => void;
  onSaveConfig: (id: string, p: { title: string; config: Record<string, unknown> }) => void;
}) {
  return (
    <>
      <AddWidgetDialog open={open.add} onOpenChange={setOpen.add} onAdd={onAdd} />
      <ShareDialog
        open={open.share}
        onOpenChange={setOpen.share}
        value={pickShare(draft)}
        onApply={(v) => onDraft((d) => ({ ...d, ...v }))}
        link={shareLinkOf(dashboard, saved)}
      />
      <DataScopeDialog
        open={open.data}
        onOpenChange={setOpen.data}
        current={dashboard ? scopeValueOf(dashboard) : NEW_DATA_SCOPE}
        chosen={draft.dataScope}
        onApply={(v) => onDraft((d) => ({ ...d, dataScope: v }))}
      />
      <WidgetConfigDialog widget={configWidget} onClose={onCloseConfig} onSave={onSaveConfig} />
    </>
  );
}

/** Phạm vi dữ liệu bảng mới chưa lưu (như dashboard cũ: toàn tổ chức). */
const NEW_DATA_SCOPE = { dataScope: 'ORG', scopeProjectId: '', scopeProgramId: '' } as const;

/** Nhãn trên thanh công cụ: phạm vi đang lưu, hoặc phạm vi vừa chọn (chưa lưu). */
function dataLabelOf(draft: DashboardDraft, dashboard: CustomDashboardDto | null): string {
  if (draft.dataScope)
    return `${DATA_SCOPE_LABEL[draft.dataScope.dataScope]} (đổi — lưu để áp dụng)`;
  return dashboard ? dataScopeSummary(dashboard) : DATA_SCOPE_LABEL.ORG;
}

/** Gợi ý kéo thả (chuột/cảm ứng và bàn phím) dưới thanh công cụ. */
function DragHint() {
  return (
    <p className="mb-4 text-xs text-muted">
      Kéo tay nắm <GripVertical className="inline h-3.5 w-3.5" aria-hidden /> để đổi chỗ.
      <span className="kbd-hint">
        {' '}
        Bằng bàn phím: Tab tới tay nắm, Space nhấc, phím mũi tên di chuyển, Space thả. Esc để huỷ
        soạn, Ctrl/Cmd+S để lưu.
      </span>
    </p>
  );
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
  dataLabel,
  canAdd,
  canSave,
  saving,
  onShare,
  onData,
  onAdd,
  onCancel,
  onSave,
}: {
  shareLabel: string;
  dataLabel: string;
  canAdd: boolean;
  canSave: boolean;
  saving: boolean;
  onShare: () => void;
  onData: () => void;
  onAdd: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={onShare}
        className="max-w-full"
        title={`Ai xem: ${shareLabel}`}
      >
        <Users className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">Ai xem: {shareLabel}</span>
      </Button>
      {/* Nhãn dài (tên nhóm + số dự án) phải co lại và cắt bằng dấu … ở màn điện thoại, không tràn khỏi trang. */}
      <Button
        variant="secondary"
        size="sm"
        onClick={onData}
        className="max-w-full"
        title={`Dữ liệu: ${dataLabel}`}
      >
        <Database className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">Dữ liệu: {dataLabel}</span>
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
  const [dataOpen, setDataOpen] = useState(false);
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
  const dataError = draft.dataScope ? dataScopeIssue(draft.dataScope) : null;
  const nameOk = draft.name.trim().length > 0;
  const canSave =
    (dashboard === null || dirty) &&
    nameOk &&
    shareError === null &&
    dataError === null &&
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

  const shareName = shareTargetName(draft, projects, teams);
  const configWidget = widgets.find((w) => w.id === configId) ?? null;

  return (
    <PageFrame size="xl" className="py-6">
      {/* Tên bảng nằm trong ô nhập nên trang cần tiêu đề riêng để có đúng một h1. */}
      <PageHeader
        title={dashboard ? 'Chỉnh sửa bảng tổng quan' : 'Bảng tổng quan mới'}
        className="mb-4"
      />
      <NameFields
        name={draft.name}
        description={draft.description}
        nameOk={nameOk}
        onChange={(p) => setDraft((d) => ({ ...d, ...p }))}
      />

      <EditorToolbar
        shareLabel={`${SCOPE_LABEL[draft.scope]}${shareName ? ` · ${shareName}` : ''}`}
        dataLabel={dataLabelOf(draft, dashboard)}
        onData={() => setDataOpen(true)}
        canAdd={canAddWidget(widgets)}
        canSave={canSave}
        saving={saving}
        onShare={() => setShareOpen(true)}
        onAdd={() => setAddOpen(true)}
        onCancel={leave}
        onSave={() => void doSave()}
      />
      <DragHint />
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
            <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Thêm widget
            </Button>
          }
        />
      ) : (
        <DashboardScopeProvider value={dashboard ? scopeInfoOf(dashboard) : null}>
          <SortableGrid
            widgets={widgets}
            issues={issues}
            onMove={(activeId, overId) => patch((l) => moveWidget(l, activeId, overId))}
            onDraggingChange={setDragging}
            onResize={(id, w) => patch((l) => resizeWidget(l, id, w))}
            onConfig={setConfigId}
            onRemove={onRemove}
          />
        </DashboardScopeProvider>
      )}

      <EditorDialogs
        dashboard={dashboard}
        saved={saved}
        draft={draft}
        open={{ add: addOpen, share: shareOpen, data: dataOpen }}
        setOpen={{ add: setAddOpen, share: setShareOpen, data: setDataOpen }}
        configWidget={configWidget}
        onCloseConfig={() => setConfigId(null)}
        onAdd={onAdd}
        onDraft={setDraft}
        onSaveConfig={(id, p) => {
          patch((l) => updateWidget(l, id, p));
          setConfigId(null);
        }}
      />
    </PageFrame>
  );
}
