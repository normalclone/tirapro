/**
 * Giá trị của ô SAU KHI lưu xong. `sent` là chuỗi đã gửi (đã cắt khoảng trắng); `current` là chữ trong ô lúc này.
 * Người dùng không gõ gì thêm trong lúc lưu → đưa ô về đúng `sent` (bản đã cắt). Đã gõ/xoá tiếp → giữ nguyên
 * chữ đang gõ (không ghi đè), phần đó vẫn dirty so với mốc đã lưu.
 */
export function settleField(current: string, sent: string): string {
  return current.trim() === sent ? sent : current;
}
