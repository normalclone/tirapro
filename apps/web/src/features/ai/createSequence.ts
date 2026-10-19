/** Một mục cần tạo: `id` để người gọi biết mục nào thành công/lỗi (vd chỉ số dòng trong danh sách đề xuất). */
export interface SequenceItem<P> {
  id: number;
  payload: P;
}

export interface SequenceResult {
  /** Các `id` đã tạo thành công, theo thứ tự. */
  created: number[];
  /** Mục lỗi kèm lý do (câu tiếng Việt do `onError` trả). */
  failed: { id: number; message: string }[];
  /** Có khi vòng dừng sớm vì lỗi mang tính hệ thống (401/403/429…): các mục chưa thử nằm ở `notTried`. */
  halted: boolean;
  notTried: number[];
}

/**
 * Tạo TUẦN TỰ từng mục (không song song) để số hiệu/thứ tự khớp danh sách. Một mục lỗi không dừng cả lượt,
 * trừ khi `onError` báo `halt` (lỗi hệ thống — lặp lại N lần chỉ vô ích hoặc làm nặng thêm throttle):
 * khi đó dừng ngay, các mục còn lại KHÔNG bị thử và được trả ở `notTried` để người dùng thử lại sau.
 */
export async function createSequentially<P>(
  items: SequenceItem<P>[],
  post: (payload: P) => Promise<unknown>,
  onError: (e: unknown) => { message: string; halt: boolean },
  onProgress?: (done: number, total: number) => void,
): Promise<SequenceResult> {
  const result: SequenceResult = { created: [], failed: [], halted: false, notTried: [] };
  for (const [n, item] of items.entries()) {
    try {
      await post(item.payload);
      result.created.push(item.id);
    } catch (e) {
      const { message, halt } = onError(e);
      result.failed.push({ id: item.id, message });
      if (halt) {
        result.halted = true;
        result.notTried = items.slice(n + 1).map((x) => x.id);
        onProgress?.(n + 1, items.length);
        return result;
      }
    }
    onProgress?.(n + 1, items.length);
  }
  return result;
}

/** Gom các lý do trùng nhau: "Hết quyền (×2); Mạng lỗi". */
export function summarizeFailures(failed: { message: string }[]): string {
  const counts = new Map<string, number>();
  for (const f of failed) counts.set(f.message, (counts.get(f.message) ?? 0) + 1);
  return [...counts].map(([m, c]) => (c > 1 ? `${m} (×${c})` : m)).join('; ');
}
