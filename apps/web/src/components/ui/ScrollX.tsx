import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { useScrollFade } from '@/lib/useScrollFade';

/**
 * Khung cuộn ngang cho bảng/dải rộng hơn màn hình: mờ mép nào còn nội dung bị khuất (`.scroll-fade-x` + `useScrollFade`)
 * để người dùng điện thoại biết còn cột bên phải, thay vì tưởng bảng bị cắt.
 */
export function ScrollX({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const fade = useScrollFade<HTMLDivElement>();
  return (
    <div
      {...rest}
      ref={fade.ref}
      style={{ ...rest.style, ...fade.style }}
      className={cn('scroll-fade-x relative overflow-x-auto', className)}
    >
      {children}
    </div>
  );
}
