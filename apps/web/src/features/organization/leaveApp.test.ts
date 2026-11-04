import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

describe('đổi/tạo tổ chức — hỏi và bỏ nháp tách nhau', () => {
  it('bỏ nháp (commitLeaveApp) chỉ nằm trong onSuccess của useSwitchOrganization', () => {
    const api = src('features/organization/api.ts');
    expect(api).toMatch(/onSuccess:[^}]*commitLeaveApp\(\)/s);
    const hook = src('lib/useLeaveGuard.ts');
    const confirmHook = hook.slice(hook.indexOf('export function useConfirmLeaveApp'));
    expect(confirmHook).not.toMatch(/onDiscard|commitLeaveApp|setSuspended|discardDirty/);
  });
});
