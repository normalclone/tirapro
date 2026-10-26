/**
 * Bảo vệ cho spec tích hợp S3: CHỈ chạy với MinIO cục bộ. Endpoint công ty (172.20.20.x) hay bất kỳ host nào khác bị từ chối
 * bằng lỗi to ngay khi nạp tệp — không để test tạo/xoá bucket trên hạ tầng thật.
 */
export function assertLocalS3Endpoint(endpoint: string): void {
  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    throw new Error(`S3 int-spec: endpoint không hợp lệ: ${endpoint}`);
  }
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error(
      `S3 int-spec TỪ CHỐI endpoint "${host}": chỉ chạy với MinIO cục bộ (127.0.0.1/localhost), tuyệt đối không dùng MinIO công ty.`,
    );
  }
}
