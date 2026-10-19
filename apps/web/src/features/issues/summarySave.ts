/**
 * Version gửi kèm lần lưu: dùng version CHỤP LÚC MỞ Ô (thay đổi xen giữa → máy chủ trả 409, không bị ghi đè âm thầm) cho tới
 * khi người dùng đã THẤY một xung đột (`conflictSeen`); từ đó "Lưu"/"Thử lại" dùng bản mới nhất — ghi đè có chủ đích.
 * Lỗi khác (500, mất mạng) không phải là đã thấy xung đột: thử lại sau đó vẫn giữ version đã chụp, nên xung đột thật vẫn ra 409.
 */
export function saveVersion(v: {
  captured: number | null;
  latest: number;
  conflictSeen: boolean;
}): number {
  return !v.conflictSeen && v.captured !== null ? v.captured : v.latest;
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
  /** Người dùng đã thấy báo xung đột trong lần sửa này (đặt lại khi mở ô mới). */
  conflictSeen: boolean;
  /** Version + tiêu đề chụp lúc mở ô. */
  startVersion: number | null;
  startSummary: string | null;
  /** Version mới nhất đang biết (dùng khi lưu lại có chủ đích sau khi đã thấy xung đột). */
  latestVersion: () => number;
  send: (version: number) => Promise<unknown>;
  /** Nạp lại bản mới nhất từ máy chủ. */
  refetch: () => Promise<{ version: number; summary: string }>;
  isConflict: (e: unknown) => boolean;
  /** Ô sửa còn gắn không (đọc lúc lỗi đến, không phải lúc bắt đầu lưu). */
  isMounted: () => boolean;
  /** Lỗi đến SAU khi ô sửa đã gỡ: không ai còn thấy ô lỗi → báo bằng cách khác (toast). */
  notifyLate: (e: unknown) => void;
  /** Báo xung đột đã được hiển thị trong ô (để lần lưu sau ghi đè có chủ đích). */
  onConflictShown: () => void;
}

async function sendWithConflictCheck(d: SummarySaveDeps): Promise<void> {
  try {
    await d.send(
      saveVersion({
        captured: d.startVersion,
        latest: d.latestVersion(),
        conflictSeen: d.conflictSeen,
      }),
    );
  } catch (e) {
    // Đã thấy xung đột (đang ghi đè có chủ đích) hoặc lỗi khác 409 → không nạp lại/tự thử lại.
    if (d.conflictSeen || !d.isConflict(e)) throw e;
    const fresh = await d.refetch(); // hỏng → ném lỗi của lần nạp
    if (
      resolveConflict({ startSummary: d.startSummary, serverSummary: fresh.summary }) === 'conflict'
    )
      throw new SummaryConflictError(fresh.summary);
    await d.send(fresh.version); // một lần duy nhất
  }
}

/**
 * Một lần "lưu" của người dùng. Chưa thấy xung đột mà gặp 409 (lần đầu, hoặc thử lại sau lỗi 500/mất mạng): nạp lại; tiêu đề
 * không đổi → TỰ thử lại đúng MỘT lần với version mới (người dùng chỉ thấy Đang lưu… → Đã lưu); tiêu đề đã đổi →
 * `SummaryConflictError`; nạp lại hỏng → lỗi của lần nạp. Lần tự thử lại lỗi (kể cả 409 nữa) → trả lỗi đó, không lặp.
 * Đã thấy xung đột → dùng version mới nhất, không tự thử lại gì.
 * Mọi lỗi cuối cùng: còn ô sửa → xung đột được ghi nhận (`onConflictShown`) và ô tự hiển thị; ô đã gỡ → `notifyLate`.
 */
export async function saveSummaryOnce(d: SummarySaveDeps): Promise<void> {
  try {
    await sendWithConflictCheck(d);
  } catch (e) {
    if (!d.isMounted()) d.notifyLate(e);
    else if (e instanceof SummaryConflictError || d.isConflict(e)) d.onConflictShown();
    throw e;
  }
}
