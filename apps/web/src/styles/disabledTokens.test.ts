import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');
const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('token vô hiệu', () => {
  it('khai báo ở cả 3 khối: sáng, tối, in', () => {
    expect(css.match(/--disabled-bg:/g)?.length).toBe(3);
    expect(css.match(/--disabled-fg:/g)?.length).toBe(3);
  });
  it.each([
    'components/ui/Button.tsx',
    'components/ui/Input.tsx',
    'components/ui/SearchSelect.tsx',
    'components/ui/PeoplePicker.tsx',
    'components/ui/RoleMultiSelect.tsx',
    'components/ui/DateInput.tsx',
  ])('%s không dùng opacity cho trạng thái vô hiệu', (p) => {
    expect(src(p)).not.toMatch(/disabled:opacity-/);
    expect(src(p)).toMatch(/disabled:bg-disabled-bg|disabled-bg/);
  });
  it('Button: hover thường (không enabled:hover) + selector vô hiệu thắng hover', () => {
    const btn = src('components/ui/Button.tsx');
    expect(btn).not.toContain('enabled:hover:');
    expect(btn).toContain('[&:disabled:not([aria-busy=true])]:bg-disabled-bg');
  });
});
