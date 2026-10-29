/** Locale hiển thị mặc định của ứng dụng — dùng cho mọi định dạng ngày giờ / số / tiền tệ. */
export const LOCALE = 'vi-VN';

const NUMBER_FORMAT = new Intl.NumberFormat(LOCALE);
/** Số nguyên/số thực có dấu phân nhóm kiểu Việt (`1.000`) — thay `toLocaleString` rải rác. */
export const fmtNumber = (n: number): string => NUMBER_FORMAT.format(n);
