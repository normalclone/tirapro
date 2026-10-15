import { MutationCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiErrorMessage, wasErrorDescribed } from './api';

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** `true` = mutation tự xử lý/không muốn toast lỗi chung của MutationCache. */
      silent?: boolean;
    };
  }
}

export const mutationCache = new MutationCache();

/**
 * Lỗi mutation: toast chung bằng câu tiếng Việt từ `apiErrorMessage` — không mutation nào thất bại âm thầm
 * khi component quên `onError`. Mutation tự xử lý: `meta: { silent: true }`.
 *
 * Tránh toast đôi: nơi nào đã tự báo qua `apiErrorMessage(e)` thì bản chung bỏ qua. Lắng nghe sự kiện `updated`/`error`
 * (phát đồng bộ SAU `await options.onError/onSettled` và sau callback của `mutate(…, { onError })`), rồi chờ thêm một
 * macrotask cho các `catch` quanh `mutateAsync` (chạy ở microtask sau đó). Giả định còn lại: không `await` I/O thật giữa lúc
 * `mutateAsync` reject và lúc gọi `apiErrorMessage` — nếu cần, dùng `meta.silent`.
 * Toast mang `id` theo nội dung → nhiều lỗi giống hệt cùng lúc chỉ hiện một toast (sonner cập nhật thay vì xếp chồng).
 */
mutationCache.subscribe((event) => {
  if (event.type !== 'updated' || event.action.type !== 'error') return;
  if (event.mutation.meta?.silent) return;
  const error = event.action.error;
  setTimeout(() => {
    if (wasErrorDescribed(error)) return;
    const message = apiErrorMessage(error);
    toast.error(message, { id: `mutation-error:${message}` });
  }, 0);
});

export const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
