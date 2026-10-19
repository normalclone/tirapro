import { canonicalTimeZone } from '@/features/digests/schedule';

/**
 * Giá trị ban đầu của ô Múi giờ ở hồ sơ: rỗng → múi giờ trình duyệt (API không nhận chuỗi rỗng); tên cũ
 * ('Asia/Saigon') → tên chuẩn để khớp một lựa chọn và không làm "có thay đổi chưa lưu" giả. Tên lạ giữ nguyên.
 */
export function initialProfileTimeZone(
  userTimeZone: string | null | undefined,
  browserTz: string,
): string {
  return canonicalTimeZone((userTimeZone ?? '').trim() || browserTz);
}
