import { expect, it } from 'vitest';
import { planToggle } from './useTaskToggle';
it('trả văn bản mới khi mục khớp', () => {
  expect(planToggle('- [ ] a\n- [ ] b', 1, true, 'b')).toBe('- [ ] a\n- [x] b');
});
it('mục ở vị trí đó đã đổi nội dung → null (không tick nhầm)', () => {
  expect(planToggle('- [ ] mới chèn\n- [ ] a\n- [ ] b', 1, true, 'b')).toBeNull();
});
