import type { ReactNode } from 'react';
import { pageContainer } from '@/components/layout/page';

/** Container chuẩn cho một trang con của cài đặt. */
export function PageShell({ children }: { children: ReactNode }) {
  return <div className={pageContainer('sm')}>{children}</div>;
}
