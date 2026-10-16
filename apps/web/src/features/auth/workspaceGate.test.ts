import { describe, expect, it } from 'vitest';
import { needsWorkspaceScreen } from './workspaceGate';

describe('needsWorkspaceScreen', () => {
  it('có workspace -> không chặn', () =>
    expect(needsWorkspaceScreen({ workspaceId: 'w1', isSystemAdmin: false }, '/')).toBe(false));

  it('không workspace, người thường -> chặn mọi đường dẫn', () => {
    expect(needsWorkspaceScreen({ workspaceId: null, isSystemAdmin: false }, '/')).toBe(true);
    expect(needsWorkspaceScreen({ workspaceId: null, isSystemAdmin: false }, '/admin')).toBe(true);
  });

  it('không workspace, admin hệ thống -> chỉ cho /admin*', () => {
    expect(
      needsWorkspaceScreen({ workspaceId: null, isSystemAdmin: true }, '/admin/accounts'),
    ).toBe(false);
    expect(needsWorkspaceScreen({ workspaceId: null, isSystemAdmin: true }, '/admin')).toBe(false);
    expect(needsWorkspaceScreen({ workspaceId: null, isSystemAdmin: true }, '/')).toBe(true);
  });

  it('"/administrator" không phải /admin (so khớp theo đoạn đường dẫn)', () => {
    expect(needsWorkspaceScreen({ workspaceId: null, isSystemAdmin: true }, '/administrator')).toBe(
      true,
    );
  });
});
