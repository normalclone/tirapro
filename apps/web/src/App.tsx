import { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { queryClient } from '@/lib/queryClient';
import { InstantTooltip } from '@/components/ui/InstantTooltip';
import { router } from '@/app/router';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/stores/theme';
import { FAB_RIGHT_CSS, toastBottomCss } from '@/lib/layoutTokens';
import { summarizeDirty, useUnsavedStore } from '@/stores/unsaved';
import { DESKTOP_MIN_QUERY } from '@/lib/bottomBar';
import { useMediaQuery } from '@/lib/useMediaQuery';

export function App() {
  const bootstrap = useAuth((s) => s.bootstrap);
  const theme = useTheme((s) => s.theme);
  // Từ lg toast nằm trên nút nổi (FAB); dưới lg (không có FAB) nằm trên thanh tab đáy.
  const desktop = useMediaQuery(DESKTOP_MIN_QUERY);
  // Dưới lg, thanh "thay đổi chưa lưu" nằm giữa nội dung và thanh tab đáy: toast nâng thêm để không che Lưu/Bỏ.
  const unsavedShown = useUnsavedStore((s) => summarizeDirty(s.entries).count > 0);
  const toastBottom = toastBottomCss(desktop, unsavedShown);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {/* Tooltip hiện tức thì cho mọi phần tử có `title` (thay tooltip trễ của trình duyệt). */}
      <InstantTooltip />
      <Toaster
        position="bottom-right"
        // Toast nằm trên nút nổi (FAB) hoặc thanh tab đáy, không đè lên chúng.
        offset={{ bottom: toastBottom, right: FAB_RIGHT_CSS }}
        mobileOffset={{
          bottom: toastBottom,
          left: 'max(16px, env(safe-area-inset-left))',
          right: 'max(16px, env(safe-area-inset-right))',
        }}
        theme={theme}
        toastOptions={{
          style: {
            background: 'var(--surface)',
            color: 'var(--ink)',
            border: '1px solid var(--border)',
          },
        }}
      />
    </QueryClientProvider>
  );
}
