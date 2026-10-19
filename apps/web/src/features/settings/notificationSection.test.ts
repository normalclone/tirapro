import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('NotificationSection (023 + 355)', () => {
  const s = () => read('features/settings/NotificationSection.tsx');
  it('mỗi sự kiện là <Switch>; hết checkbox in-app tự viết và hết toast "Đã lưu"', () => {
    expect(s()).toContain("from '@/components/ui/Switch'");
    expect(s()).toContain('<Switch');
    expect(s().match(/type="checkbox"/g)?.length).toBe(1); // chỉ còn ô "Gửi cả qua email"
    expect(s()).not.toContain('disabled={update.isPending}');
    expect(s()).not.toContain('toast.success');
    expect(s()).not.toContain('truncate'); // gợi ý không bị cắt
  });
  it('hiện <SaveStatus> trong card, thử lại gửi lại bản vá bị lỗi', () => {
    expect(s()).toContain("from '@/components/ui/SaveStatus'");
    expect(s()).toMatch(/<SaveStatus[^>]*onRetry/s);
  });
  it('dòng con là vùng mở rộng có aria-expanded/aria-controls, mở bằng grid-rows 0fr→1fr, tắt khi reduced-motion', () => {
    expect(s()).toContain('aria-expanded');
    expect(s()).toContain('aria-controls');
    expect(s()).toMatch(/grid-rows-\[0fr\]/);
    expect(s()).toMatch(/grid-rows-\[1fr\]/);
    expect(s()).toMatch(/motion-reduce:transition-none/);
    expect(s()).toMatch(/duration-base/);
    expect(s()).toMatch(/ease-out-quart/);
  });
  it('email vẫn bật được khi in-app tắt (tuỳ chọn email không phụ thuộc switch)', () => {
    expect(s()).toContain('isOptionsOpen(');
    expect(s()).not.toMatch(/disabled=\{!inApp\}|disabled=\{!checked\}/);
  });
  it('mutation: dùng prefsMutationOptions (optimistic + nối tiếp), không còn onSuccess invalidate thô', () => {
    const api = read('features/settings/api.ts');
    expect(api).toContain('prefsMutationOptions');
    const lib = read('features/settings/notificationPrefs.ts');
    expect(lib).toMatch(/scope:\s*\{\s*id:/);
    expect(lib).toContain('cancelQueries');
    expect(lib).toContain('isMutating');
  });
});
