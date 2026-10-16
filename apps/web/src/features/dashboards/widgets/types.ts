/** Props chung của mọi ô: tiêu đề do người dùng đặt + cấu hình đã lưu (`config` chưa kiểm kiểu — đọc bằng `cfg*`). */
export interface WidgetProps {
  title: string;
  config: Record<string, unknown>;
}
