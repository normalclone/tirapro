/** Trạng thái chọn nhiều: tập id + mốc (id bấm gần nhất, điểm bắt đầu của dải Shift+click). Bất biến — mọi hàm trả bản mới. */
export interface Selection {
  ids: ReadonlySet<string>;
  anchor: string | null;
}

export const EMPTY_SELECTION: Selection = { ids: new Set<string>(), anchor: null };

/** Bật/tắt một id; id vừa bấm thành mốc. */
export function toggleId(s: Selection, id: string): Selection {
  const ids = new Set(s.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids, anchor: id };
}

/** Thêm (`on`) hoặc bớt cả nhóm id (chọn cả mục/trang). Mốc giữ nguyên. */
export function setMany(s: Selection, many: readonly string[], on: boolean): Selection {
  const ids = new Set(s.ids);
  for (const id of many) {
    if (on) ids.add(id);
    else ids.delete(id);
  }
  return { ids, anchor: s.anchor };
}

/**
 * Shift+click: chọn mọi id nằm giữa mốc và `to` (gồm cả hai đầu) theo THỨ TỰ HIỂN THỊ `order`, giữ phần đã chọn. Mốc giữ
 * nguyên (Shift+click tiếp theo tính lại từ cùng mốc). Chưa có mốc hoặc mốc/`to` không còn trong `order` → chỉ bật `to`
 * và lấy nó làm mốc.
 */
export function selectRange(s: Selection, order: readonly string[], to: string): Selection {
  const a = s.anchor === null ? -1 : order.indexOf(s.anchor);
  const b = order.indexOf(to);
  if (a < 0 || b < 0) {
    const ids = new Set(s.ids);
    ids.add(to);
    return { ids, anchor: to };
  }
  const ids = new Set(s.ids);
  for (const id of order.slice(Math.min(a, b), Math.max(a, b) + 1)) ids.add(id);
  return { ids, anchor: s.anchor };
}

/** Bỏ chọn tất cả. Luôn trả CHÍNH `EMPTY_SELECTION` nên bỏ chọn khi đã rỗng không gây vẽ lại. */
export const clearSelection = (): Selection => EMPTY_SELECTION;

/** Bỏ các id không còn tồn tại (dữ liệu làm mới/realtime). Không có gì để bỏ → trả CHÍNH `s`. */
export function pruneSelection(s: Selection, valid: ReadonlySet<string>): Selection {
  let changed = false;
  const ids = new Set<string>();
  for (const id of s.ids) {
    if (valid.has(id)) ids.add(id);
    else changed = true;
  }
  const anchorGone = s.anchor !== null && !valid.has(s.anchor);
  if (!changed && !anchorGone) return s;
  return { ids, anchor: anchorGone ? null : s.anchor };
}
