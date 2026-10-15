/** Bỏ dấu tiếng Việt (kể cả đ/Đ), chữ thường, cắt khoảng trắng hai đầu — để tìm kiếm không dấu. */
export const normalizeVi = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();
