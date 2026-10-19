export interface Placement {
  containerId: string;
  /** Vị trí 0-based trong danh sách đích SAU khi thả, và độ dài danh sách đó. */
  index: number;
  total: number;
  /** Mốc ngay TRÊN (rank nhỏ hơn) / ngay DƯỚI sau khi thả — đúng hai tham số của API. */
  afterId: string | null;
  beforeId: string | null;
  /** Hai mốc ở vị trí CŨ (để Hoàn tác). */
  origin: { afterId: string | null; beforeId: string | null };
  crossContainer: boolean;
  /** Cùng container và thứ tự không đổi → không gọi API. */
  unchanged: boolean;
}

export interface DropInput {
  activeId: string;
  fromContainer: string;
  fromItems: string[];
  toContainer: string;
  toItems: string[];
  /** id thẻ đang rê tới; null hoặc = toContainer nghĩa là rê vào khoảng trống của container. */
  overId: string | null;
  /** Tâm thẻ đang kéo nằm dưới giữa thẻ `over` (chỉ dùng khi sang container khác). */
  below: boolean;
}

const arrayMove = <T>(a: T[], from: number, to: number): T[] => {
  const out = [...a];
  out.splice(to, 0, out.splice(from, 1)[0]!);
  return out;
};

const neighbors = (list: string[], id: string) => {
  const i = list.indexOf(id);
  if (i < 0) return { afterId: null, beforeId: null }; // không có trong danh sách: đừng lấy list[0] làm "mốc dưới"
  return { afterId: list[i - 1] ?? null, beforeId: list[i + 1] ?? null };
};

/** Đường kẻ chèn khi kéo sang container khác: ngay trước thẻ phía dưới, hoặc ngay sau thẻ phía trên. */
export function hintOf(p: Placement | null): { id: string; edge: 'before' | 'after' } | null {
  if (!p || !p.crossContainer) return null;
  if (p.beforeId) return { id: p.beforeId, edge: 'before' };
  if (p.afterId) return { id: p.afterId, edge: 'after' };
  return null;
}

export function computePlacement(i: DropInput): Placement {
  const cross = i.fromContainer !== i.toContainer;
  const toContainerSelf = i.overId === null || i.overId === i.toContainer;
  const base = i.toItems.filter((id) => id !== i.activeId);
  let next: string[];
  if (!cross) {
    if (i.overId === i.activeId) next = [...i.toItems];
    else if (toContainerSelf) next = [...base, i.activeId];
    else {
      const from = i.toItems.indexOf(i.activeId);
      const to = i.toItems.indexOf(i.overId!);
      next = from < 0 || to < 0 ? [...i.toItems] : arrayMove(i.toItems, from, to);
    }
  } else {
    const at = toContainerSelf ? -1 : base.indexOf(i.overId!);
    const idx = at < 0 ? base.length : at + (i.below ? 1 : 0);
    next = [...base.slice(0, idx), i.activeId, ...base.slice(idx)];
  }
  const index = next.indexOf(i.activeId);
  return {
    containerId: i.toContainer,
    index,
    total: next.length,
    ...neighbors(next, i.activeId),
    origin: neighbors(i.fromItems, i.activeId),
    crossContainer: cross,
    unchanged:
      !cross && next.length === i.fromItems.length && next.every((id, k) => id === i.fromItems[k]),
  };
}

type Uid = string | number;
interface SortableData {
  containerId: Uid;
  items: Uid[];
  index: number;
}
interface RectLike {
  top: number;
  height: number;
}

/** Hình dạng tối thiểu của `Active`/`Over` của dnd-kit (để test không cần dnd-kit). */
export interface DndLike {
  active: {
    id: Uid;
    data: { current?: { sortable?: SortableData } };
    rect: { current: { translated: RectLike | null } };
  };
  over: null | {
    id: Uid;
    data: { current?: { sortable?: SortableData; container?: { items: Uid[] } } };
    rect: RectLike;
  };
}

export function placementFromDnd(e: DndLike): Placement | null {
  const a = e.active.data.current?.sortable;
  if (!a || !e.over) return null;
  const o = e.over.data.current;
  const t = e.active.rect.current.translated;
  return computePlacement({
    activeId: String(e.active.id),
    fromContainer: String(a.containerId),
    fromItems: a.items.map(String),
    toContainer: String(o?.sortable?.containerId ?? e.over.id),
    toItems: (o?.sortable?.items ?? o?.container?.items ?? []).map(String),
    overId: String(e.over.id),
    below: !!t && t.top + t.height / 2 > e.over.rect.top + e.over.rect.height / 2,
  });
}
