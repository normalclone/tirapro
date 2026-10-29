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
  it('đổi ô email thì GHIM dòng con mở (không đóng dưới chân con trỏ khi email-only bỏ tick)', () => {
    const t = s();
    const at = t.indexOf('update.mutate({ email: { [emailKey]: next } })');
    expect(at).toBeGreaterThan(0);
    expect(t.slice(at, at + 400)).toMatch(/setManual\(\(m\) => \(\{ \.\.\.m, \[key\]: true \}\)\)/);
  });
  it('nhãn "Gửi qua email" (độc lập in-app) + gợi ý "kể cả khi tắt thông báo trong ứng dụng"', () => {
    expect(s()).toContain('Gửi qua email');
    expect(s()).not.toContain('Gửi cả qua email');
    expect(s()).toContain('kể cả khi tắt thông báo trong ứng dụng');
  });
  it('tên truy cập có tên sự kiện: nhóm + nút mở + ô email tham chiếu nhãn Switch; gợi ý ra khỏi <label> sang aria-describedby', () => {
    const t = s();
    expect(t).toContain('role="group"');
    expect(t).toMatch(/aria-labelledby=\{`\$\{[a-zA-Z]+\} \$\{[a-zA-Z]+\}`\}/);
    expect(t).toContain('aria-describedby');
    expect(t).not.toMatch(/<label[^>]*>[^]*?\{hint\}[^]*?<\/label>/);
  });
  it('cảm ứng: gợi ý KHÔNG kéo ngược lên đè hộp nhãn (mobile:audit text-overlap) — nhãn có py-2.5 nên không dùng -mt-*', () => {
    const t = s();
    const hint = /<p id=\{hintId\}\s+className="([^"]+)"/.exec(t)?.[1] ?? '';
    expect(hint).not.toBe('');
    expect(hint).not.toMatch(/-mt-/);
  });
});
