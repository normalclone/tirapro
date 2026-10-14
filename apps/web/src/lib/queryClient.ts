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

/**
 * Lỗi mutation: toast chung bằng câu tiếng Việt từ `apiErrorMessage` — không còn mutation nào
 * thất bại âm thầm khi component quên `onError`.
 *
 * Tránh toast đôi: nơi nào đã tự báo lỗi qua `apiErrorMessage(e)` (call-site `mutate(..., { onError })`
 * hoặc try/catch quanh `mutateAsync`) thì bản chung bỏ qua. MutationCache chạy TRƯỚC các callback đó
 * nên phải chờ một tick (setTimeout 0) rồi mới kiểm tra. Mutation muốn hoàn toàn không toast thì
 * đặt `meta: { silent: true }`.
 *
 * CẢNH BÁO: một tick chỉ đủ cho callback đồng bộ/microtask. `onError`/`onSettled` nào làm I/O bất đồng bộ
 * thật (await mạng, timer) rồi mới gọi `apiErrorMessage` sẽ bị toast đôi — hãy đặt `meta: { silent: true }`.
 */
export const mutationCache = new MutationCache({
  onError: (error, _variables, _context, mutation) => {
    if (mutation.meta?.silent) return;
    setTimeout(() => {
      if (!wasErrorDescribed(error)) toast.error(apiErrorMessage(error));
    }, 0);
  },
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
