import { describe, expect, it, vi } from 'vitest';
import { MembersService } from './members.service';

/** Vai trò RIÊNG của dự án chỉ gán được ở đúng dự án đó; cấp tổ chức không bao giờ nhận vai trò dự án. */
function make(found: string[]) {
  const findMany = vi.fn((_a: unknown) => Promise.resolve(found.map((id) => ({ id }))));
  const svc = new MembersService(
    { role: { findMany } } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const validate = (
    svc as unknown as {
      validateRoles: (
        o: string,
        ids: string[],
        scope: string,
        projectId?: string,
      ) => Promise<string[]>;
    }
  ).validateRoles.bind(svc);
  return { validate, findMany };
}

describe('validateRoles — vai trò riêng của dự án', () => {
  it('cấp DỰ ÁN: chấp nhận mẫu (projectId null) HOẶC vai trò riêng của ĐÚNG dự án', async () => {
    const { validate, findMany } = make(['tpl', 'own']);
    expect(await validate('w1', ['tpl', 'own'], 'PROJECT', 'p1')).toEqual(['tpl', 'own']);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['tpl', 'own'] },
        scope: 'PROJECT',
        OR: [{ organizationId: 'w1' }, { organizationId: null }],
        AND: [{ OR: [{ projectId: null }, { projectId: 'p1' }] }],
      },
      select: { id: true },
    });
  });

  it('vai trò riêng của dự án KHÁC không khớp → API từ chối (403)', async () => {
    const { validate } = make(['tpl']); // 'otherProjectRole' không có trong kết quả truy vấn
    await expect(
      validate('w1', ['tpl', 'otherProjectRole'], 'PROJECT', 'p1'),
    ).rejects.toMatchObject({
      status: 403,
    });
  });

  it('cấp TỔ CHỨC: chỉ vai trò không gắn dự án nào (không truyền projectId)', async () => {
    const { validate, findMany } = make(['org']);
    await validate('w1', ['org'], 'ORGANIZATION');
    const where = (findMany.mock.calls[0]![0] as { where: { AND: unknown[] } }).where;
    expect(where.AND).toEqual([{ OR: [{ projectId: null }] }]);
  });
});
