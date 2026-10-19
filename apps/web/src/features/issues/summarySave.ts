/**
 * Version gửi kèm lần lưu: LẦN ĐẦU của một lần sửa dùng version chụp lúc mở ô (thay đổi xen giữa → máy chủ trả 409, không
 * bị ghi đè âm thầm); sau một lần lỗi ("Thử lại", ✓ sau xung đột) người dùng đã thấy lỗi nên dùng bản mới nhất — ghi đè có chủ đích.
 */
export function saveVersion(v: {
  captured: number | null;
  latest: number;
  attempt: number;
}): number {
  return v.attempt === 0 && v.captured !== null ? v.captured : v.latest;
}

/**
 * 409 ở lần lưu đầu: chỉ khi TIÊU ĐỀ trên máy chủ khác tiêu đề lúc mở ô mới là xung đột thật. Trường khác đổi (kể cả do chính
 * người dùng, vd đổi ưu tiên) thì tiêu đề không ai đụng tới → thử lại với version mới. Không biết tiêu đề lúc mở ô → xung đột.
 */
export function resolveConflict(v: {
  startSummary: string | null;
  serverSummary: string;
}): 'retry' | 'conflict' {
  return v.startSummary !== null && v.serverSummary === v.startSummary ? 'retry' : 'conflict';
}

/** Xung đột thật: tiêu đề trên máy chủ đã bị người khác đổi (kèm tiêu đề hiện tại để người dùng quyết định). */
export class SummaryConflictError extends Error {
  constructor(readonly serverSummary: string) {
    super('Tiêu đề đã bị đổi trên máy chủ');
  }
}

export interface SummarySaveDeps {
  /** Số lần lưu lỗi trước đó trong lần sửa này (0 = lần đầu). */
  attempt: number;
  /** Version + tiêu đề chụp lúc mở ô. */
  startVersion: number | null;
  startSummary: string | null;
  /** Version mới nhất đang biết (dùng khi lưu lại có chủ đích sau lỗi). */
  latestVersion: () => number;
  send: (version: number) => Promise<unknown>;
  /** Nạp lại bản mới nhất từ máy chủ. */
  refetch: () => Promise<{ version: number; summary: string }>;
  isConflict: (e: unknown) => boolean;
}

/**
 * Một lần "lưu" của người dùng. Lần đầu mà gặp 409: nạp lại; tiêu đề không đổi → TỰ thử lại đúng MỘT lần với version mới
 * (người dùng chỉ thấy Đang lưu… → Đã lưu); tiêu đề đã đổi → `SummaryConflictError`; nạp lại hỏng → lỗi của lần nạp.
 * Lần tự thử lại lỗi (kể cả 409 nữa) → trả lỗi đó, không lặp. Từ lần lưu thứ hai (attempt ≥ 1) không tự thử lại gì.
 */
export async function saveSummaryOnce(d: SummarySaveDeps): Promise<void> {
  try {
    await d.send(
      saveVersion({ captured: d.startVersion, latest: d.latestVersion(), attempt: d.attempt }),
    );
  } catch (e) {
    if (d.attempt !== 0 || !d.isConflict(e)) throw e;
    const fresh = await d.refetch(); // hỏng → ném lỗi của lần nạp
    if (
      resolveConflict({ startSummary: d.startSummary, serverSummary: fresh.summary }) === 'conflict'
    )
      throw new SummaryConflictError(fresh.summary);
    await d.send(fresh.version); // một lần duy nhất
  }
}
