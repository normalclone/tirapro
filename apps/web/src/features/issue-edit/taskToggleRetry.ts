/**
 * Lõi "tick một ô rồi lưu có OCC, gặp xung đột thì nạp lại và thử lại MỘT lần" — dùng chung cho tick ở mô tả
 * và ở bình luận, tách khỏi React/axios để test được luồng thử lại.
 */
export interface ToggleRetryDeps {
  /** Văn bản + version MỚI NHẤT đang có (cache); `undefined` nếu chưa có. */
  read: () => { text: string; version: number } | undefined;
  /** Văn bản mới, hoặc `null` nếu mục ở vị trí đó đã đổi nội dung (không tick nhầm). */
  plan: (text: string) => string | null;
  write: (next: string, version: number) => Promise<unknown>;
  /** Nạp lại bản mới nhất vào cache (sau xung đột). */
  reload: () => Promise<unknown>;
  isConflict: (e: unknown) => boolean;
  onMissing: () => void;
  onMismatch: () => void;
  onError: (e: unknown) => void;
}

export async function toggleWithRetry(d: ToggleRetryDeps): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = d.read();
    if (!cur || !cur.text) return d.onMissing();
    const next = d.plan(cur.text);
    if (next === null) return d.onMismatch();
    try {
      await d.write(next, cur.version);
      return;
    } catch (e) {
      if (!d.isConflict(e) || attempt === 1) return d.onError(e);
      await d.reload();
    }
  }
}
