import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { AUTH_ONLY_KEY } from '../../common/decorators/auth-only.decorator';
import type { AuthUser } from '../../common/types/request';
import { MeController } from './me.controller';

const user = { id: 'U1', workspaceId: null } as unknown as AuthUser;
const req = (extra: object = {}) => extra as Request & { apiKey?: unknown };

function make() {
  const search = vi.fn().mockResolvedValue({ data: [], pageInfo: {} });
  return { ctrl: new MeController({ search } as never), search };
}

describe('MeController GET /me/search', () => {
  it('chỉ cần đăng nhập (@AuthOnly), không gắn workspace', () => {
    expect(Reflect.getMetadata(AUTH_ONLY_KEY, MeController.prototype.run)).toBe(true);
  });

  it('chuyển jql/cursor/limit cho service, dùng user.id từ token; limit kẹp 1..200, mặc định 50', async () => {
    const { ctrl, search } = make();
    await ctrl.run(user, req(), 'type = Bug', 'cur', '9999');
    expect(search).toHaveBeenLastCalledWith('U1', { jql: 'type = Bug', cursor: 'cur', limit: 200 });
    await ctrl.run(user, req(), 'type = Bug');
    expect(search).toHaveBeenLastCalledWith('U1', {
      jql: 'type = Bug',
      cursor: undefined,
      limit: 50,
    });
  });

  it('thiếu jql → 422, không tìm', async () => {
    const { ctrl, search } = make();
    await expect(ctrl.run(user, req(), '  ')).rejects.toMatchObject({ status: 422 });
    expect(search).not.toHaveBeenCalled();
  });

  it('API key (gắn một workspace) bị từ chối 403', async () => {
    const { ctrl, search } = make();
    await expect(ctrl.run(user, req({ apiKey: { id: 'k' } }), 'type = Bug')).rejects.toMatchObject({
      status: 403,
    });
    expect(search).not.toHaveBeenCalled();
  });
});
