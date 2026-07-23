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

/** Bóc lỗi envelope { error: { code, message } } thành message thân thiện. */
export function apiErrorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as { error?: { message?: string } } | undefined;
    return data?.error?.message ?? e.message;
  }
  return e instanceof Error ? e.message : 'Đã có lỗi xảy ra';
}
