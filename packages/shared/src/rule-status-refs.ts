/**
 * Đổi các tham chiếu trạng thái (id) trong một quy tắc automation khi trạng thái bị thay bằng trạng thái khác (đổi quy trình
 * theo loại việc, xoá trạng thái có thay thế, migrate). Hàm THUẦN — dùng chung cho API và script migrate; phần đọc/ghi DB nằm ở
 * `rewriteRuleStatusRefs` (apps/api).
 *
 * `map`: id cũ → danh sách id mới (đã khử trùng, thứ tự có nghĩa: phần tử đầu là "chính"). MỘT trạng thái cũ có thể sang NHIỀU
 * trạng thái mới (mỗi quy trình theo loại việc một trạng thái); bên gọi có thể kèm cả id cũ trong danh sách nếu quy trình cũ
 * vẫn còn việc. Danh sách RỖNG = không còn trạng thái thay thế → quy tắc không ánh xạ được (`unmappable`).
 *
 * Tham chiếu trạng thái trong quy tắc:
 *  - `triggerConfig.toStatusId` (+ `toStatusIds`): một id → nhiều id thì chuyển sang `toStatusIds` (khớp bất kỳ).
 *  - điều kiện `statusId`: `eq`/`neq` một id → nhiều id thì thành `in`/`nin`; `in`/`nin` thay từng phần tử.
 *  - hành động `transition`: `toStatusId` = trạng thái chính, các trạng thái còn lại vào `alsoStatusIds`; lúc chạy engine chọn
 *    cái thuộc quy trình của việc.
 */
export type StatusRefMap = ReadonlyMap<string, readonly string[]>;

export interface RuleStatusParts {
  triggerConfig: unknown;
  conditions: unknown;
  actions: unknown;
}

export interface RuleStatusRewrite extends RuleStatusParts {
  /** Có tham chiếu tới ít nhất một id có trong `map`. */
  touched: boolean;
  /** Các id cũ (có trong `map`) mà quy tắc tham chiếu — để báo "id cũ → id mới" cho từng quy tắc. */
  touchedIds: string[];
  /** Id cũ được tham chiếu mà `map` không có trạng thái thay thế (danh sách rỗng). Khác rỗng → giữ nguyên nội dung. */
  unmappable: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const dedupe = (xs: string[]): string[] => [...new Set(xs)];

export function remapRuleStatusIds(rule: RuleStatusParts, map: StatusRefMap): RuleStatusRewrite {
  const touched = new Set<string>();
  const unmappable = new Set<string>();
  /** Thay một id: không có trong map → giữ nguyên; có → các id mới (rỗng → ghi nhận không ánh xạ được, giữ id cũ). */
  const expand = (id: string): string[] => {
    const targets = map.get(id);
    if (!targets) return [id];
    touched.add(id);
    if (targets.length === 0) {
      unmappable.add(id);
      return [id];
    }
    return [...targets];
  };

  // ---- triggerConfig
  let triggerConfig = rule.triggerConfig;
  if (isRecord(triggerConfig)) {
    const next: Record<string, unknown> = { ...triggerConfig };
    const ids: string[] = [];
    let seen = false;
    if (typeof next.toStatusId === 'string') {
      seen = true;
      ids.push(...expand(next.toStatusId));
    }
    if (Array.isArray(next.toStatusIds)) {
      seen = true;
      for (const x of next.toStatusIds) if (typeof x === 'string') ids.push(...expand(x));
    }
    if (seen) {
      const all = dedupe(ids);
      if (all.length === 1) {
        next.toStatusId = all[0];
        delete next.toStatusIds;
      } else {
        delete next.toStatusId;
        next.toStatusIds = all;
      }
      triggerConfig = next;
    }
  }

  // ---- conditions
  let conditions = rule.conditions;
  if (Array.isArray(conditions)) {
    conditions = conditions.map((c: unknown) => {
      if (!isRecord(c) || c.field !== 'statusId') return c;
      const op = c.op;
      if ((op === 'eq' || op === 'neq') && typeof c.value === 'string') {
        const ids = dedupe(expand(c.value));
        if (ids.length === 1) return { ...c, value: ids[0] };
        return { ...c, op: op === 'eq' ? 'in' : 'nin', value: ids };
      }
      if ((op === 'in' || op === 'nin') && Array.isArray(c.value)) {
        return {
          ...c,
          value: dedupe(c.value.flatMap((x: unknown) => (typeof x === 'string' ? expand(x) : []))),
        };
      }
      return c;
    });
  }

  // ---- actions
  let actions = rule.actions;
  if (Array.isArray(actions)) {
    actions = actions.map((a: unknown) => {
      if (!isRecord(a) || a.type !== 'transition' || typeof a.toStatusId !== 'string') return a;
      const ids = [...expand(a.toStatusId)];
      const also = Array.isArray(a.alsoStatusIds)
        ? a.alsoStatusIds.flatMap((x: unknown) => (typeof x === 'string' ? expand(x) : []))
        : [];
      const rest = dedupe([...ids.slice(1), ...also]).filter((x) => x !== ids[0]);
      const out: Record<string, unknown> = { ...a, toStatusId: ids[0] };
      if (rest.length) out.alsoStatusIds = rest;
      else delete out.alsoStatusIds;
      return out;
    });
  }

  if (unmappable.size > 0)
    return {
      touched: true,
      touchedIds: [...touched],
      unmappable: [...unmappable],
      triggerConfig: rule.triggerConfig,
      conditions: rule.conditions,
      actions: rule.actions,
    };
  return {
    touched: touched.size > 0,
    touchedIds: [...touched],
    unmappable: [],
    triggerConfig,
    conditions,
    actions,
  };
}
