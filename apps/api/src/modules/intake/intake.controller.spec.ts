import { describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@tirapro/types';
import { IntakeController } from './intake.controller';

describe('IntakeController.report — canComment suy từ quyền hiệu lực', () => {
  const dto = { projectId: 'p1', kind: 'BUG', summary: 'abc' } as never;
  const run = async (user: Record<string, unknown>) => {
    const intake = { report: vi.fn(() => Promise.resolve({ deduped: false })) };
    await new IntakeController(intake as never).report('w1', user as never, dto);
    return (intake.report.mock.calls[0] as unknown[])[3];
  };

  it('có comment:create => true; thiếu => false; system admin => true', async () => {
    expect(await run({ id: 'u1', permissions: [PERMISSIONS.COMMENT_CREATE] })).toEqual({
      canComment: true,
    });
    expect(await run({ id: 'u1', permissions: [PERMISSIONS.ISSUE_CREATE] })).toEqual({
      canComment: false,
    });
    expect(await run({ id: 'u1', permissions: undefined })).toEqual({ canComment: false });
    expect(await run({ id: 'u1', isSystemAdmin: true })).toEqual({ canComment: true });
  });
});
