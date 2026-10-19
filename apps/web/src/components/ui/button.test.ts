import { describe, expect, it } from 'vitest';
import { buttonVariants } from './Button';

describe('Button size="icon" — vùng chạm (RB6)', () => {
  const cls = buttonVariants({ size: 'icon' }).split(' ');
  it('chuột 36px, cảm ứng (pointer: coarse) lớn lên 44px cả hai chiều', () => {
    expect(cls).toContain('h-9');
    expect(cls).toContain('w-9');
    expect(cls).toContain('[@media(pointer:coarse)]:h-11');
    expect(cls).toContain('[@media(pointer:coarse)]:w-11');
  });
  it('các cỡ chữ (sm/md/lg) không bị đổi', () => {
    expect(buttonVariants({ size: 'sm' })).not.toContain('pointer:coarse');
  });
});
