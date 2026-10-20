import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock('@/lib/api', () => ({
  api: { get: (...a: unknown[]) => get(...a) },
  refreshAccessToken: vi.fn(),
}));
vi.mock('@/lib/socket', () => ({ disconnectSocket: vi.fn() }));
vi.mock('@/lib/sessionCache', () => ({ clearSessionCaches: vi.fn() }));

import { useAuth } from './auth';

const me = (permissions: string[]) => ({
  data: {
    user: { id: 'u1', isSystemAdmin: false },
    workspaceId: 'w1',
    permissions,
    memberships: [],
  },
});

beforeEach(() => {
  get.mockReset();
  useAuth.setState({
    status: 'authed',
    user: { id: 'u1', isSystemAdmin: false } as never,
    workspaceId: 'w1',
    permissions: ['member:manage', 'workspace:view'],
    memberships: [],
  });
});

describe('useAuth.refreshMe', () => {
  it('nạp lại quyền từ /auth/me: mất member:manage thì can() sai ngay', async () => {
    expect(useAuth.getState().can('member:manage')).toBe(true);
    get.mockResolvedValue(me(['workspace:view']));
    await useAuth.getState().refreshMe();
    expect(get).toHaveBeenCalledWith('/auth/me');
    expect(useAuth.getState().can('member:manage')).toBe(false);
    expect(useAuth.getState().status).toBe('authed');
  });
  it('lỗi mạng: giữ nguyên trạng thái, không ném, không thành khách', async () => {
    get.mockRejectedValue(new Error('network'));
    await expect(useAuth.getState().refreshMe()).resolves.toBeUndefined();
    expect(useAuth.getState().status).toBe('authed');
    expect(useAuth.getState().can('member:manage')).toBe(true);
  });
  it('chưa đăng nhập: không gọi API', async () => {
    useAuth.setState({ status: 'guest' });
    await useAuth.getState().refreshMe();
    expect(get).not.toHaveBeenCalled();
  });
});
