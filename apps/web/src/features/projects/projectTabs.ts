/** Segment URL của các màn nằm trong menu "Thêm" (khớp `MORE` ở ProjectLayout; Rủi ro/Tự động hoá ở trang ngoài dự án). */
const MORE_SEGMENTS = ['triage', 'activity', 'trash', 'config'] as const;
export type MoreSeg = (typeof MORE_SEGMENTS)[number];

/** Nhãn chữ của tab hiện không (màn hẹp, dưới `sm`)? Chỉ tab đang mở, để biết đang ở view nào; từ `sm` trở lên luôn hiện (CSS lo). */
export function tabLabelVisible(isActive: boolean): boolean {
  return isActive;
}

/** Đang ở màn thuộc menu "Thêm" (Việc mới vào, Hoạt động, Thùng rác, Cấu hình)? → nút "Thêm" sáng + hiện tên màn. */
export function activeMoreSeg(seg: string): MoreSeg | null {
  return (MORE_SEGMENTS as readonly string[]).includes(seg) ? (seg as MoreSeg) : null;
}
