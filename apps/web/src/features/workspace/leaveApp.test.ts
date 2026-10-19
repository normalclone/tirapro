import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

describe('đổi/tạo không gian làm việc — hỏi và bỏ nháp tách nhau', () => {
  it('bỏ nháp (commitLeaveApp) chỉ nằm trong onSuccess của useSwitchWorkspace', () => {
    const api = src('features/workspace/api.ts');
    expect(api).toMatch(/onSuccess:[^}]*commitLeaveApp\(\)/s);
    const hook = src('lib/useLeaveGuard.ts');
    const confirmHook = hook.slice(hook.indexOf('export function useConfirmLeaveApp'));
    expect(confirmHook).not.toMatch(/onDiscard|commitLeaveApp|setSuspended|discardDirty/);
  });
  it('CreateWorkspaceModal không tự hỏi (tránh confirm lồng trong Dialog); hỏi ở nút mở hộp trước', () => {
    expect(src('features/workspace/CreateWorkspaceModal.tsx')).not.toMatch(
      /useConfirmLeaveApp|confirmLeave/,
    );
    expect(src('features/workspace/WorkspaceSwitcher.tsx')).toMatch(
      /confirmLeave\(\)\.then\(\(ok\) => ok && setCreateOpen\(true\)\)/,
    );
  });
});
