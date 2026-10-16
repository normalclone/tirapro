import type { KeyboardEvent } from 'react';

/** Chỉ số mục radio kế tiếp theo phím bấm (mũi tên vòng tròn, Home/End); null nếu phím không điều hướng. */
export function nextRadioIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/**
 * onKeyDown cho container `role="radiogroup"` (các mục `role="radio"` dùng roving tabindex: chỉ mục đang chọn có
 * tabIndex 0): mũi tên chuyển chọn + chuyển focus sang mục mới bằng cách bấm nó.
 */
export function radioGroupKeyDown(e: KeyboardEvent<HTMLElement>) {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = i < 0 ? null : nextRadioIndex(e.key, i, items.length);
  if (next === null) return;
  e.preventDefault();
  items[next]!.focus();
  items[next]!.click();
}
