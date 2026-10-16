import { describe, expect, it, vi } from 'vitest';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { TeamsService } from './teams.service';

describe('TeamsService.assignToProject — dự án riêng tư (P14)', () => {
  function make() {
    const prisma = {
      team: { findFirst: vi.fn(() => Promise.resolve({ id: 't1', key: 'T', name: 'Nhóm' })) },
      teamMember: { findMany: vi.fn(() => Promise.resolve([{ userId: 'u2' }])) },
    };
    const members = { addProject: vi.fn(() => Promise.resolve({})) };
    const access = { assertCanSee: vi.fn(() => Promise.resolve()) };
    const service = new TeamsService(prisma as never, members as never, access as never);
    return { service, prisma, members, access };
  }

  it('người gọi không thấy dự án riêng tư → 404 "Dự án", không thêm ai vào dự án', async () => {
    const { service, members, access } = make();
    access.assertCanSee.mockRejectedValue(new NotFoundAppException('Dự án'));
    await expect(service.assignToProject('w1', 't1', 'hr', ['r1'], 'u1')).rejects.toMatchObject({
      status: 404,
    });
    expect(access.assertCanSee).toHaveBeenCalledWith('u1', 'w1', 'hr', 'Dự án');
    expect(members.addProject).not.toHaveBeenCalled();
  });

  it('người gọi thấy dự án → thêm từng thành viên như cũ', async () => {
    const { service, members } = make();
    await expect(service.assignToProject('w1', 't1', 'p1', ['r1'], 'u1')).resolves.toEqual({
      success: true,
      added: 1,
    });
    expect(members.addProject).toHaveBeenCalledWith('w1', 'p1', 'u2', ['r1'], 'u1');
  });

  it('không có người gọi (hệ thống) → không kiểm quyền xem', async () => {
    const { service, access } = make();
    await service.assignToProject('w1', 't1', 'p1', ['r1']);
    expect(access.assertCanSee).not.toHaveBeenCalled();
  });
});
