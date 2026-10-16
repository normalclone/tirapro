import { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { queryClient } from '@/lib/queryClient';
import { InstantTooltip } from '@/components/ui/InstantTooltip';
import { router } from '@/app/router';
import { useAuth } from '@/stores/auth';
import { useTheme } from '@/stores/theme';
import { FAB_RIGHT_CSS, TOAST_BOTTOM_CSS } from '@/lib/layoutTokens';

export function App() {
  const bootstrap = useAuth((s) => s.bootstrap);
  const theme = useTheme((s) => s.theme);

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
        // Toast nằm trên nút nổi (FAB), không đè lên nó.
        offset={{ bottom: TOAST_BOTTOM_CSS, right: FAB_RIGHT_CSS }}
        mobileOffset={{
          bottom: TOAST_BOTTOM_CSS,
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
