/** Chế độ AI của máy chủ: `unknown` = chưa tải xong / lỗi tải → dùng chữ trung tính (không nhận là AI, cũng không phủ nhận). */
export type AiMode = 'ai' | 'basic' | 'unknown';

export function aiMode(available: boolean | undefined): AiMode {
  if (available === undefined) return 'unknown';
  return available ? 'ai' : 'basic';
}

const GENERATE_COPY: Record<AiMode, { title: string; description: string; placeholder: string }> = {
  ai: {
    title: 'Tạo công việc bằng AI',
    description: 'Mô tả yêu cầu — AI sẽ tách thành các công việc nhỏ.',
    placeholder:
      'VD: Xây màn hình đăng nhập email/mật khẩu, validate input, đăng nhập Google, sửa lỗi token hết hạn…',
  },
  basic: {
    title: 'Tạo công việc từ danh sách',
    description:
      'Dán danh sách yêu cầu — hệ thống tách theo từng dòng (hoặc từng câu nếu chỉ có một dòng). Chưa dùng AI.',
    placeholder:
      'VD (mỗi việc một dòng):\n- Xây màn hình đăng nhập\n- Đăng nhập Google\n- Sửa lỗi token hết hạn',
  },
  unknown: {
    title: 'Tạo công việc từ danh sách',
    description: 'Dán danh sách hoặc mô tả yêu cầu — sẽ được tách thành các công việc nhỏ.',
    placeholder: 'VD (mỗi việc một dòng):\n- Xây màn hình đăng nhập\n- Đăng nhập Google',
  },
};

export const generateCopy = (mode: AiMode) => GENERATE_COPY[mode];

/** Nhãn ô mục tiêu của Trợ lý lập sprint. */
export function goalLabel(mode: AiMode): string {
  if (mode === 'ai') return 'Mục tiêu sprint (tuỳ chọn, để AI chọn việc khớp mục tiêu)';
  if (mode === 'basic')
    return 'Mục tiêu sprint (tuỳ chọn, để ưu tiên việc có từ khoá khớp mục tiêu)';
  return 'Mục tiêu sprint (tuỳ chọn, để chọn việc khớp mục tiêu)';
}
