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

/**
 * Như `nextRadioIndex` nhưng BỎ QUA mục bị vô hiệu: đi tiếp theo hướng phím cho tới mục bật gần nhất (mũi tên vòng tròn,
 * Home/End về mục bật đầu/cuối). Trả null nếu phím không điều hướng, hoặc không còn mục bật nào khác mục hiện tại.
 */
export function nextEnabledRadioIndex(
  key: string,
  index: number,
  disabled: readonly boolean[],
): number | null {
  const count = disabled.length;
  if (nextRadioIndex(key, index, count) === null) return null;
  if (key === 'Home' || key === 'End') {
    const order = key === 'Home' ? [...disabled.keys()] : [...disabled.keys()].reverse();
    return order.find((i) => !disabled[i]) ?? null;
  }
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
  for (let n = 1; n < count; n++) {
    const i = (((index + step * n) % count) + count) % count;
    if (!disabled[i]) return i;
  }
  return null;
}

/**
 * `radioGroupKeyDown` cho nhóm có mục vô hiệu (`disabled` native hoặc `aria-disabled="true"`): mũi tên nhảy qua mục tắt
 * (mục tắt không focus/bấm được nên bản gốc sẽ kẹt tại đó). Nhóm không có mục tắt hành xử y hệt `radioGroupKeyDown`.
 */
export function radioGroupKeyDownSkipDisabled(e: KeyboardEvent<HTMLElement>) {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const off = items.map(
    (el) => el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled'),
  );
  const next = nextEnabledRadioIndex(e.key, i, off);
  if (next === null) return;
  e.preventDefault();
  items[next]!.focus();
  items[next]!.click();
}
