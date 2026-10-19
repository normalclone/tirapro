/**
 * Chất liệu rail trái dùng chung (RB8): `SubNavLayout` (menu tĩnh 240px) và `RailLayout` (master–detail 288px) cùng
 * nền `bg-surface`, đường kẻ `border-r` sát mép, đệm ngang 12px, từ `lg` cuộn dọc riêng và đệm dọc 20px — đổi một nơi
 * là cả hai đổi. Chỉ rộng khác nhau (RAIL_WIDTH): menu tĩnh hẹp hơn danh sách động có ô tìm/cây trang.
 */
export const RAIL_SURFACE =
  'shrink-0 border-border bg-surface px-3 lg:overflow-y-auto lg:border-r lg:py-5';

export const RAIL_WIDTH = {
  /** Menu con tĩnh (Cài đặt, Quản lý, Kết nối, Cấu hình dự án). */
  nav: 'lg:w-60',
  /** Danh sách động master–detail (Bộ lọc, Wiki). */
  master: 'lg:w-72',
} as const;
