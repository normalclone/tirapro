/**
 * Cờ tính năng build-time (Vite). Bật bằng biến môi trường lúc build/dev, vd `VITE_FEATURE_REPOS=1`.
 * Mặc định TẮT: ẩn UI nhưng không xoá code/API.
 */
export const FEATURES = {
  /** Mục "Kho mã" (GitHub/GitLab) ở Tích hợp + khối "Liên kết code" trên trang công việc. */
  repos: import.meta.env.VITE_FEATURE_REPOS === '1',
} as const;
