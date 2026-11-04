import { describe, expect, it, vi } from 'vitest';
import { ProgramsService } from './programs.service';

/**
 * Nhóm dự án là của RIÊNG từng người. Prisma giả ghi lại `where`: mọi đường đọc/ghi phải khoá theo `ownerId = người gọi`,
 * nhóm của người khác trả 404, liên kết của người khác không bao giờ bị động tới.
 */
const OWN = (extra: Record<string, unknown> = {}) => ({
  workspaceId: 'w1',
  ownerId: 'me',
  ...extra,
});

function make(
  over: { owned?: boolean; clash?: boolean; projectExists?: boolean; programsFound?: number } = {},
) {
  const row = {
    id: 'g1',
    workspaceId: 'w1',
    name: 'Team',
    description: null,
    color: null,
    startDate: null,
    targetDate: null,
    createdAt: new Date('2026-11-05T00:00:00Z'),
    projects: [],
  };
  const prisma = {
    program: {
      findMany: vi.fn(() => Promise.resolve([row])),
      // `findFirst`: dùng cho get/require (khoá theo chủ) và kiểm trùng tên — phân biệt qua `where.name`.
      findFirst: vi.fn((a: { where: { name?: string } }) =>
        a.where.name !== undefined
          ? Promise.resolve(over.clash ? { id: 'other' } : null)
          : Promise.resolve(over.owned === false ? null : row),
      ),
      create: vi.fn(() => Promise.resolve({ id: 'g1' })),
      update: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
      count: vi.fn(() => Promise.resolve(over.programsFound ?? 2)),
    },
    project: {
      findFirst: vi.fn(() => Promise.resolve(over.projectExists === false ? null : { id: 'p1' })),
      findMany: vi.fn((a: { where: { id: { in: string[] } } }) =>
        Promise.resolve(a.where.id.in.map((id) => ({ id }))),
      ),
    },
    projectProgram: {
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
      createMany: vi.fn(() => Promise.resolve({ count: 0 })),
      findMany: vi.fn(() =>
        Promise.resolve([{ program: { id: 'g1', name: 'Team', color: '#111' } }]),
      ),
    },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const access = {
    visibleWhere: vi.fn(() => Promise.resolve({})),
    assertCanSee: vi.fn(() => Promise.resolve()),
  };
  const service = new ProgramsService(prisma as never, access as never);
  return { service, prisma, access };
}

describe('ProgramsService — nhóm của riêng từng người', () => {
  it('list chỉ lấy nhóm của người gọi', async () => {
    const { service, prisma } = make();
    await service.list('w1', 'me');
    expect(prisma.program.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: OWN() }));
  });

  it('get nhóm của người khác → 404 (cùng lỗi như không tồn tại); where khoá theo chủ', async () => {
    const { service, prisma } = make({ owned: false });
    await expect(service.get('w1', 'g-cua-nguoi-khac', 'me')).rejects.toMatchObject({
      status: 404,
    });
    expect(prisma.program.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: OWN({ id: 'g-cua-nguoi-khac' }) }),
    );
  });

  it('update / remove nhóm của người khác → 404, không ghi', async () => {
    const { service, prisma } = make({ owned: false });
    await expect(service.update('w1', 'gx', { name: 'Đổi' }, 'me')).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.remove('w1', 'gx', 'me')).rejects.toMatchObject({ status: 404 });
    expect(prisma.program.update).not.toHaveBeenCalled();
    expect(prisma.program.delete).not.toHaveBeenCalled();
  });

  it('create: chủ luôn là người gọi (body.ownerId bị bỏ qua), tên kiểm trùng CHỈ trong nhóm của người đó', async () => {
    const { service, prisma } = make();
    await service.create('w1', { name: ' Team ', ownerId: 'nguoi-khac' } as never, 'me');
    expect(prisma.program.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'w1', ownerId: 'me', name: 'Team' } }),
    );
    expect(prisma.program.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerId: 'me', name: 'Team' }) }),
    );
  });

  it('create: trùng tên với nhóm CỦA CHÍNH MÌNH → 422, không ghi', async () => {
    const { service, prisma } = make({ clash: true });
    await expect(service.create('w1', { name: 'Team' }, 'me')).rejects.toMatchObject({
      status: 422,
    });
    expect(prisma.program.create).not.toHaveBeenCalled();
  });

  it('create/update kèm projectIds: chỉ gắn dự án người gọi thấy vào nhóm CỦA MÌNH', async () => {
    const { service, prisma, access } = make();
    await service.create('w1', { name: 'Team', projectIds: ['p1', 'p2', 'p1'] }, 'me');
    expect(access.visibleWhere).toHaveBeenCalledWith('me', 'w1');
    expect(prisma.projectProgram.createMany).toHaveBeenCalledWith({
      data: [
        { projectId: 'p1', programId: 'g1' },
        { projectId: 'p2', programId: 'g1' },
      ],
      skipDuplicates: true,
    });
  });
});

describe('ProgramsService.setForProject — nhóm của NGƯỜI GỌI cho một dự án', () => {
  it('chỉ nhận nhóm của chính mình; xoá liên kết CHỈ của nhóm của mình (không đụng liên kết của người khác)', async () => {
    const { service, prisma, access } = make();
    const r = await service.setForProject('w1', 'p1', ['g1', 'g2', 'g1'], 'me');
    expect(access.assertCanSee).toHaveBeenCalledWith('me', 'w1', 'p1');
    expect(prisma.program.count).toHaveBeenCalledWith({
      where: { id: { in: ['g1', 'g2'] }, workspaceId: 'w1', ownerId: 'me' },
    });
    expect(prisma.projectProgram.deleteMany).toHaveBeenCalledWith({
      where: {
        projectId: 'p1',
        program: { ownerId: 'me', workspaceId: 'w1' },
        programId: { notIn: ['g1', 'g2'] },
      },
    });
    expect(prisma.projectProgram.createMany).toHaveBeenCalledWith({
      data: [
        { projectId: 'p1', programId: 'g1' },
        { projectId: 'p1', programId: 'g2' },
      ],
      skipDuplicates: true,
    });
    // Kết quả trả về cũng chỉ là nhóm của người gọi.
    expect(prisma.projectProgram.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'p1', program: { ownerId: 'me', workspaceId: 'w1' } },
      }),
    );
    expect(r).toEqual({ projectId: 'p1', programs: [{ id: 'g1', name: 'Team', color: '#111' }] });
  });

  it('[] chỉ gỡ khỏi các nhóm của mình, vẫn không đụng nhóm người khác', async () => {
    const { service, prisma } = make();
    await service.setForProject('w1', 'p1', [], 'me');
    expect(prisma.program.count).not.toHaveBeenCalled();
    expect(prisma.projectProgram.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', program: { ownerId: 'me', workspaceId: 'w1' } },
    });
    expect(prisma.projectProgram.createMany).not.toHaveBeenCalled();
  });

  it('nhóm không phải của mình (của người khác / không tồn tại) → 422, không ghi; dự án không có → 404; không thấy → lỗi assertCanSee', async () => {
    const bad = make({ programsFound: 1 });
    await expect(
      bad.service.setForProject('w1', 'p1', ['g1', 'cua-nguoi-khac'], 'me'),
    ).rejects.toMatchObject({ status: 422 });
    expect(bad.prisma.projectProgram.deleteMany).not.toHaveBeenCalled();
    const missing = make({ projectExists: false });
    await expect(missing.service.setForProject('w1', 'p1', [], 'me')).rejects.toMatchObject({
      status: 404,
    });
    const hidden = make();
    hidden.access.assertCanSee.mockRejectedValue(new Error('ẩn'));
    await expect(hidden.service.setForProject('w1', 'p1', ['g1'], 'me')).rejects.toThrow('ẩn');
    expect(hidden.prisma.projectProgram.deleteMany).not.toHaveBeenCalled();
  });

  it('không đòi quyền quản trị dự án: chỉ cần thấy dự án (assertCanSee), không tra quyền nào khác', async () => {
    const { service, access } = make({ programsFound: 1 });
    await service.setForProject('w1', 'p1', ['g1'], 'me');
    expect(access.assertCanSee).toHaveBeenCalledTimes(1);
  });
});
