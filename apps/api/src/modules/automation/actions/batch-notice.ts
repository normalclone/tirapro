/**
 * Gộp thông báo automation trong MỘT lần sửa hàng loạt: với mỗi (lô, quy tắc, người nhận) chỉ lần gọi đầu tiên "giành" được
 * quyền gửi — kiểm-và-đặt chạy đồng bộ nên an toàn dù các việc của lô được engine xử lý song song. Sự kiện của lô phát và xử
 * lý trong cùng tiến trình (EventEmitter2) nên sổ trong bộ nhớ là đủ; mục cũ tự dọn.
 */
const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 5_000;
const claimed = new Map<string, number>();

export function claimBatchNotice(
  batchId: string,
  ruleId: string,
  recipientId: string,
  now = Date.now(),
): boolean {
  if (claimed.size >= MAX_ENTRIES || (claimed.size > 0 && claimed.size % 256 === 0)) {
    for (const [k, at] of claimed) if (now - at > TTL_MS) claimed.delete(k);
    if (claimed.size >= MAX_ENTRIES) claimed.clear();
  }
  const key = `${batchId}|${ruleId}|${recipientId}`;
  if (claimed.has(key)) return false;
  claimed.set(key, now);
  return true;
}
