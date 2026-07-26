import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { getAccessToken, setAccessToken } from './auth-token';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

export const api = axios.create({ baseURL: BASE_URL, withCredentials: true });

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Single-flight refresh: nhiều request 401 cùng lúc (VÀ bootstrap lúc tải trang) chỉ refresh 1 lần.
let refreshing: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  try {
    const res = await axios.post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true });
    const token = res.data?.accessToken ?? null;
    setAccessToken(token);
    return token;
  } catch {
    setAccessToken(null);
    return null;
  }
}

/** Refresh access token dùng chung 1 promise (bootstrap + interceptor không refresh chồng → tránh xoay refresh-token 2 lần). */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as AxiosRequestConfig & { _retry?: boolean };
    const status = error.response?.status;
    const url = original?.url ?? '';
    if (status === 401 && !original._retry && !url.includes('/auth/')) {
      original._retry = true;
      const token = await refreshAccessToken();
      if (token) {
        original.headers = { ...original.headers, Authorization: `Bearer ${token}` };
        return api(original);
      }
      // refresh thất bại → phát sự kiện để store đăng xuất
      window.dispatchEvent(new CustomEvent('tirapro:logout'));
    }
    return Promise.reject(error);
  },
);

/**
 * Câu tiếng Việt cho các mã lỗi hay gặp — phải nói được NGƯỜI DÙNG CẦN LÀM GÌ,
 * không chỉ báo có lỗi. Mã nào không có ở đây thì dùng message của máy chủ.
 */
const ERROR_MESSAGES: Record<string, string> = {
  VERSION_CONFLICT: 'Người khác vừa sửa mục này — hãy tải lại trang để xem bản mới nhất rồi thao tác lại.',
  FORBIDDEN: 'Bạn không có quyền làm việc này. Liên hệ quản trị viên nếu cần được cấp quyền.',
  UNAUTHORIZED: 'Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.',
  NOT_FOUND: 'Không tìm thấy dữ liệu. Có thể nó vừa bị xoá hoặc đường dẫn không đúng.',
  VALIDATION_ERROR: 'Thông tin nhập chưa hợp lệ — kiểm tra lại các ô được đánh dấu.',
  RATE_LIMITED: 'Bạn thao tác hơi nhanh. Chờ vài giây rồi thử lại.',
  WORKFLOW_TRANSITION_INVALID: 'Quy trình không cho chuyển thẳng sang trạng thái này. Hãy chọn một trạng thái trong danh sách gợi ý.',
};

/** Bóc lỗi envelope { error: { code, message } } thành câu người dùng đọc hiểu. */
export function apiErrorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const err = (e.response?.data as { error?: { code?: string; message?: string } } | undefined)?.error;
    if (err?.code && ERROR_MESSAGES[err.code]) return ERROR_MESSAGES[err.code];
    if (err?.message) return err.message;
    // Không có phản hồi = mất mạng hoặc máy chủ chưa sẵn sàng.
    if (!e.response) return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.';
    return e.message;
  }
  return e instanceof Error ? e.message : 'Có lỗi xảy ra. Hãy thử lại; nếu vẫn lỗi, tải lại trang.';
}
