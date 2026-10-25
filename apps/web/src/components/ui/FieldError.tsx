import type { ReactNode } from 'react';

/** Lời lỗi dưới một trường: chữ `text-danger` (token), có `id` để `aria-describedby` của ô trỏ tới. Không rung/không nháy. */
export function FieldErrorText({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 text-xs text-danger">
      {children}
    </p>
  );
}
