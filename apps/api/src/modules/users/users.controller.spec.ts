import { describe, expect, it, vi } from 'vitest';
import { UsersController } from './users.controller';

function make() {
  const users = {
    changePassword: vi.fn(() => Promise.resolve({ success: true, revokedAtMs: 2_000_500 })),
  };
  const auth = {
    reissueSession: vi.fn(() =>
      Promise.resolve({ accessToken: 'NEWAT', expiresIn: 900, refreshToken: 'NEWRT' }),
    ),
  };
  const config = { get: vi.fn(() => false) };
  const events = { emit: vi.fn() };
  const ctrl = new UsersController(users as never, auth as never, config as never, events as never);
  const res = { cookie: vi.fn() };
  return { ctrl, users, auth, events, res };
}

const user = { id: 'u1', workspaceId: 'w1' } as never;
const body = { currentPassword: 'Old-Passw0rd', newPassword: 'New-Passw0rd1' };
const req = (extra: Record<string, unknown> = {}) =>
  ({ headers: {}, ip: '1.1.1.1', ...extra }) as never;

describe('UsersController.changePassword', () => {
  it('cấp phiên mới cho thiết bị đang đổi + phát sự kiện ngắt socket CHỈ của token cũ (kèm mốc thu hồi)', async () => {
    const { ctrl, users, auth, events, res } = make();
    const out = await ctrl.changePassword(user, body, req(), res as never);
    expect(users.changePassword).toHaveBeenCalledWith('u1', body);
    expect(auth.reissueSession).toHaveBeenCalledWith('u1', 'w1', expect.anything());
    expect(res.cookie).toHaveBeenCalledWith('tirapro_rt', 'NEWRT', expect.anything());
    expect(events.emit).toHaveBeenCalledWith('account.sessions_revoked', {
      userId: 'u1',
      revokedAtMs: 2_000_500,
    });
    expect(out).toEqual({ success: true, accessToken: 'NEWAT', expiresIn: 900 });
  });

  it('xác thực bằng API key -> 403, không đổi mật khẩu, không phát sự kiện', async () => {
    const { ctrl, users, events, res } = make();
    await expect(
      ctrl.changePassword(user, body, req({ apiKey: { id: 'k1' } }), res as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(users.changePassword).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });
});
