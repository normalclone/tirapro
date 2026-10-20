/**
 * Chốt chặn cho spec tích hợp (`*.int-spec.ts`) tự NẠP và XOÁ dữ liệu: chỉ chạy trên DB nháp. Mặc định là TỪ CHỐI — tên DB phải
 * kết thúc bằng một hậu tố trong danh sách cho phép; DB thật/demo/dùng chung bị gọi đích danh để thông báo rõ.
 */
const ALLOWED = /(_w2c|_parity|_scratch)$/;
/** DB thật / demo / dùng chung của dự án (đặt tên đích danh để câu lỗi nói đúng nguyên nhân). */
const PROTECTED = /^(projira|projira_ux|projira_final|projira_integ.*)$/;

/** Tên DB trong URL kết nối (không query, không dấu `/` thừa); chuỗi rỗng nếu URL hỏng hoặc không có tên. */
export function parityDatabaseName(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.replace(/^\/+/, ''));
  } catch {
    return '';
  }
}

export function assertParityDatabase(url: string): void {
  const name = parityDatabaseName(url);
  if (PROTECTED.test(name)) {
    throw new Error(
      `PARITY_DATABASE_URL trỏ vào "${name}" — đây là DB thật/dùng chung. Spec này nạp và xoá dữ liệu; từ chối chạy. ` +
        'Dùng DB nháp riêng (tên kết thúc bằng _w2c, _parity hoặc _scratch).',
    );
  }
  if (!ALLOWED.test(name)) {
    throw new Error(
      `PARITY_DATABASE_URL trỏ vào "${name || '(không đọc được tên DB)'}" — chỉ chạy trên DB nháp có tên kết thúc bằng ` +
        '_w2c, _parity hoặc _scratch. Từ chối chạy.',
    );
  }
}
