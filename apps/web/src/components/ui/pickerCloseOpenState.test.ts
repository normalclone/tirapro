import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

/**
 * Mọi đường ĐÓNG danh sách (chọn người, Esc, bấm ra ngoài, nút đóng) phải báo cho `onOpenChange` — nếu không, truy vấn "còn trống"
 * (`enabled: open`) vẫn bật sau khi chọn. Hai chỗ gọi `useAssigneeAvailability`: PeoplePicker và AssigneeSuggestButton.
 */
describe.each([
  ['components/ui/PeoplePicker.tsx', 'onOpenChange?.(o)'],
  ['features/ai/AssigneeSuggestButton.tsx', 'availability.onOpenChange(o)'],
])('%s', (file, notify) => {
  const text = src(file);
  it('chỉ có MỘT hàm đổi trạng thái mở, và nó báo ra ngoài', () => {
    const setters = text.match(/\bsetOpen\(/g) ?? [];
    expect(setters).toHaveLength(1);
    expect(text).toContain(notify);
  });
  it('Popover.Root và nhánh chọn người đều đi qua hàm đó', () => {
    expect(text).toMatch(/onOpenChange=\{changeOpen\}|onOpenChange=\{\(o\) => changeOpen\(o\)\}/);
    expect(text).toMatch(/changeOpen\(false\)/);
  });
});
