import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller';

function make() {
  const auth = {
    logoutAll: vi.fn(() => Promise.resolve({ success: true })),
    refresh: vi.fn(() =>
      Promise.resolve({ accessToken: 'AT', refreshToken: 'RT2', user: { id: 'u1' } }),
    ),
  };
  const tokens = { workspaceFromExpiredAccess: vi.fn(() => null) };
  const config = { get: vi.fn(() => false) };
  const ctrl = new AuthController(auth as never, tokens as never, {} as never, config as never);
  const res = { cookie: vi.fn(), clearCookie: vi.fn() };
  const req = (cookies: Record<string, string> | undefined) =>
    ({ cookies, headers: {}, ip: '127.0.0.1' }) as never;
  return { ctrl, auth, res, req };
}

describe('AuthController.refresh', () => {
  it('không có cookie refresh => 200 { accessToken: null }, KHÔNG gọi service, KHÔNG đặt cookie (không còn 401 đỏ cho khách)', async () => {
    const { ctrl, auth, res, req } = make();
    expect(await ctrl.refresh(req(undefined), res as never)).toEqual({ accessToken: null });
    expect(await ctrl.refresh(req({}), res as never)).toEqual({ accessToken: null });
    expect(await ctrl.refresh(req({ tirapro_rt: '' }), res as never)).toEqual({
      accessToken: null,
    });
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });
  it('có cookie => xoay token như cũ và đặt cookie mới, không lộ refreshToken trong body', async () => {
    const { ctrl, auth, res, req } = make();
    const out = await ctrl.refresh(req({ tirapro_rt: 'fam.raw' }), res as never);
    expect(auth.refresh).toHaveBeenCalledWith('fam.raw', expect.anything(), null);
    expect(res.cookie).toHaveBeenCalledWith(
      'tirapro_rt',
      'RT2',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(out).toEqual({ accessToken: 'AT', user: { id: 'u1' } });
  });
  it('cookie sai/hết hạn/đã thu hồi => lỗi từ service vẫn lan ra (401), không bị nuốt', async () => {
    const { ctrl, auth, res, req } = make();
    auth.refresh.mockRejectedValueOnce(Object.assign(new Error('bad'), { status: 401 }));
    await expect(ctrl.refresh(req({ tirapro_rt: 'x' }), res as never)).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('AuthController.logoutAll', () => {
  const user = { id: 'u1' } as never;
  it('phiên người dùng -> thu hồi mọi phiên và xoá cookie refresh', async () => {
    const { ctrl, auth, res } = make();
    const out = await ctrl.logoutAll(user, { headers: {} } as never, res as never);
    expect(auth.logoutAll).toHaveBeenCalledWith('u1');
    expect(res.clearCookie).toHaveBeenCalledWith('tirapro_rt', expect.anything());
    expect(out).toEqual({ success: true });
  });
  it('xác thực bằng API key -> 403, không thu hồi gì', async () => {
    const { ctrl, auth, res } = make();
    await expect(
      ctrl.logoutAll(user, { headers: {}, apiKey: { id: 'k1' } } as never, res as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(auth.logoutAll).not.toHaveBeenCalled();
  });
});
