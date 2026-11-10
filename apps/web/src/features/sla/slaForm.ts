type SlaField = 'name';
export interface SlaFieldIssue {
  field: SlaField;
  message: string;
}

/** Lỗi nhập liệu của hộp "Thêm cam kết" theo trường (quy tắc giữ nguyên: chỉ bắt buộc tên); [] = hợp lệ. */
export function validateSlaForm(f: { name: string }): SlaFieldIssue[] {
  return f.name.trim()
    ? []
    : [{ field: 'name', message: 'Hãy nhập tên cam kết để dễ nhận ra sau này' }];
}

export interface SlaScopeOverlap {
  /** Tên mức ưu tiên của nhóm trùng; `null` = nhóm "Mọi mức ưu tiên". */
  priorityName: string | null;
  count: number;
}

/**
 * Nhóm các cam kết ĐANG BẬT theo phạm vi (mức ưu tiên; `null` = mọi mức) và trả về những nhóm có ≥ 2 cam kết
 * — khi đó một công việc khớp nhiều cam kết cùng lúc, hệ thống chỉ áp 1 (cam kết chặt nhất). Dùng để cảnh báo
 * người cấu hình (TIRA-BUG-30), đúng mong muốn "không nên tự động chạy đồng thời cả hai cam kết => cảnh báo".
 */
export function findSlaScopeOverlaps(
  policies: {
    active: boolean;
    priorityId: string | null;
    priority?: { name: string } | null;
  }[],
): SlaScopeOverlap[] {
  const groups = new Map<string, SlaScopeOverlap>();
  for (const p of policies) {
    if (!p.active) continue;
    const key = p.priorityId ?? '__all__';
    const g = groups.get(key) ?? { priorityName: p.priority?.name ?? null, count: 0 };
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.count >= 2);
}
