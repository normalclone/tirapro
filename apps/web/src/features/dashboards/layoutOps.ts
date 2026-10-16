import { arrayMove } from '@dnd-kit/sortable';
import {
  DASHBOARD_LIMITS,
  widgetInputSchema,
  type DashboardInput,
  type DashboardScopeValue,
  type DashboardWidgetType,
} from '@tirapro/shared';
import { WIDGET_REGISTRY } from './registry';
import type { WidgetWidth } from './widgetLayout';

/**
 * Bản nháp một ô trong chế độ soạn. `id` luôn có: ô đã lưu mang id máy chủ, ô mới mang id tạm (`isNew`) chỉ để dnd-kit
 * và React phân biệt — id tạm KHÔNG gửi lên máy chủ.
 */
export interface DraftWidget {
  id: string;
  isNew?: boolean;
  type: string;
  title: string;
  config: Record<string, unknown>;
  position: { order: number; w: WidgetWidth };
}

/** Toàn bộ trạng thái đang soạn — dùng để so với bản đã lưu (`isDirty`) và dựng body gửi lên (`toDashboardBody`). */
export interface DashboardDraft {
  name: string;
  description: string;
  scope: DashboardScopeValue;
  projectId: string;
  teamId: string;
  widgets: DraftWidget[];
}

/** Id tạm cho ô mới. */
export function newClientId(): string {
  return `new-${crypto.randomUUID()}`;
}

/** Sắp theo `order` (ổn định) rồi đánh lại 0..n-1 liên tục. */
export function normalizeOrder(list: DraftWidget[]): DraftWidget[] {
  return list
    .map((w, i) => ({ w, i }))
    .sort((a, b) => a.w.position.order - b.w.position.order || a.i - b.i)
    .map(({ w }, order) =>
      w.position.order === order ? w : { ...w, position: { ...w.position, order } },
    );
}

/** Kéo `activeId` tới vị trí của `overId` (đúng nghĩa dnd-kit sortable). Id lạ / cùng ô → trả nguyên mảng. */
export function moveWidget(list: DraftWidget[], activeId: string, overId: string): DraftWidget[] {
  if (activeId === overId) return list;
  const sorted = normalizeOrder(list);
  const from = sorted.findIndex((w) => w.id === activeId);
  const to = sorted.findIndex((w) => w.id === overId);
  if (from < 0 || to < 0) return list;
  return normalizeOrder(
    arrayMove(sorted, from, to).map((w, order) => ({ ...w, position: { ...w.position, order } })),
  );
}

/** Đổi cỡ S/M/L = w 1/2/3; giá trị khác bị bỏ qua. */
export function resizeWidget(list: DraftWidget[], id: string, w: WidgetWidth): DraftWidget[] {
  if (w !== 1 && w !== 2 && w !== 3) return list;
  if (!list.some((x) => x.id === id)) return list;
  return list.map((x) => (x.id === id ? { ...x, position: { ...x.position, w } } : x));
}

export function removeWidget(list: DraftWidget[], id: string): DraftWidget[] {
  return normalizeOrder(list.filter((w) => w.id !== id));
}

/** Đặt ô về vị trí `index` trong thứ tự hiện tại (dùng cho Hoàn tác sau khi gỡ). */
export function insertWidget(
  list: DraftWidget[],
  widget: DraftWidget,
  index: number,
): DraftWidget[] {
  const sorted = normalizeOrder(list);
  const at = Math.max(0, Math.min(index, sorted.length));
  sorted.splice(at, 0, widget);
  return normalizeOrder(sorted.map((w, order) => ({ ...w, position: { ...w.position, order } })));
}

export function updateWidget(
  list: DraftWidget[],
  id: string,
  patch: { title?: string; config?: Record<string, unknown> },
): DraftWidget[] {
  return list.map((w) => (w.id === id ? { ...w, ...patch } : w));
}

export const canAddWidget = (list: DraftWidget[]): boolean =>
  list.length < DASHBOARD_LIMITS.widgetsPerDashboard;

/** Thêm một ô mới vào CUỐI, theo mặc định của loại. Đủ giới hạn ô thì trả nguyên mảng. */
export function addWidget(
  list: DraftWidget[],
  type: DashboardWidgetType,
  makeId: () => string = newClientId,
): DraftWidget[] {
  if (!canAddWidget(list)) return list;
  const def = WIDGET_REGISTRY[type];
  const added: DraftWidget = {
    id: makeId(),
    isNew: true,
    type,
    title: def.defaultTitle,
    config: structuredClone(def.defaultConfig),
    position: { order: list.length, w: def.defaultW },
  };
  return normalizeOrder([...list, added]);
}

/** Chuỗi JSON có khoá sắp xếp: hai object cùng nội dung luôn cho cùng chuỗi, bất kể thứ tự khoá. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function fingerprint(d: DashboardDraft): string {
  return stable({
    name: d.name.trim(),
    description: (d.description ?? '').trim(),
    scope: d.scope,
    projectId: d.projectId || null,
    teamId: d.teamId || null,
    widgets: normalizeOrder(d.widgets).map((w) => [
      w.id,
      w.type,
      w.title,
      w.config,
      w.position.order,
      w.position.w,
    ]),
  });
}

/** Có thay đổi chưa lưu không (so theo nội dung, không theo tham chiếu). */
export function isDirty(saved: DashboardDraft, current: DashboardDraft): boolean {
  return fingerprint(saved) !== fingerprint(current);
}

/** Mức chia sẻ có đủ/đúng dự án + nhóm chưa? `null` = hợp lệ (cùng luật `scopeRules` của máy chủ). */
export function shareValidation(
  scope: DashboardScopeValue,
  projectId: string,
  teamId: string,
): string | null {
  if (scope === 'PROJECT') {
    if (!projectId) return 'Chọn dự án để chia sẻ';
    if (teamId) return 'Mức "theo dự án" không đi kèm nhóm';
  } else if (scope === 'TEAM') {
    if (!teamId) return 'Chọn nhóm để chia sẻ';
    if (projectId) return 'Mức "theo nhóm" không đi kèm dự án';
  } else {
    if (projectId) return 'Chỉ mức "theo dự án" mới gắn dự án';
    if (teamId) return 'Chỉ mức "theo nhóm" mới gắn nhóm';
  }
  return null;
}

/** Ô nào chưa đủ/đúng cấu hình (vd Burndown chưa chọn dự án) → lời nhắc tiếng Việt, theo id ô. */
export function draftIssues(list: DraftWidget[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const w of normalizeOrder(list)) {
    const parsed = widgetInputSchema.safeParse({
      type: w.type,
      title: w.title,
      config: w.config,
      position: w.position,
    });
    if (!parsed.success) out[w.id] = parsed.error.issues[0]?.message ?? 'Cấu hình chưa hợp lệ';
  }
  return out;
}

/** Body `POST/PUT /dashboards`: bỏ id tạm của ô mới, chỉ gửi đúng id dự án/nhóm của mức chia sẻ đang chọn. */
export function toDashboardBody(d: DashboardDraft): DashboardInput {
  return {
    name: d.name.trim(),
    description: d.description.trim() || null,
    scope: d.scope,
    projectId: d.scope === 'PROJECT' ? d.projectId : undefined,
    teamId: d.scope === 'TEAM' ? d.teamId : undefined,
    widgets: normalizeOrder(d.widgets).map((w) => ({
      ...(w.isNew ? {} : { id: w.id }),
      type: w.type as DashboardWidgetType,
      title: w.title.trim(),
      config: w.config,
      position: w.position,
    })),
  };
}
