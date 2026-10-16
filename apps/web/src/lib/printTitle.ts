import { format } from 'date-fns';

/**
 * Tiêu đề tài liệu khi in: Chrome/Edge lấy `document.title` làm tên file PDF gợi ý nên bỏ ký tự cấm trong tên file
 * (`\ / : * ? " < > |`) và gắn ngày `dd-MM-yyyy` → `"Tổng quan — 15-10-2026"`.
 */
export function printTitle(base: string, date: Date): string {
  const clean = base
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${clean || 'Tirapro'} — ${format(date, 'dd-MM-yyyy')}`;
}
