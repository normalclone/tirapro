import { describe, expect, it, vi } from 'vitest';
import { ClientsService } from './clients.service';

describe('ClientsService — dự án riêng tư (P14)', () => {
  const visible = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };
  const whereOf = (fn: ReturnType<typeof vi.fn>, i = 0) =>
    (fn.mock.calls[i] as unknown as [{ where: unknown }])[0].where;

  const contract = (id: string, project: { id: string; key: string; name: string } | null) => ({
    id,
    clientId: 'c1',
    projectId: project?.id ?? null,
    name: `HĐ ${id}`,
    code: null,
    value: 100,
    currency: 'VND',
    startDate: null,
    endDate: null,
    note: null,
    createdAt: new Date(),
    project,
  });

  function make(found: { id: string }[] = []) {
    const clientRow = {
      id: 'c1',
      workspaceId: 'w1',
      name: 'KH',
      contactName: null,
      email: null,
      phone: null,
      note: null,
      createdAt: new Date(),
      projects: [],
      contracts: [
        contract('k1', { id: 'pub', key: 'PUB', name: 'Công khai' }),
        contract('k2', { id: 'hr', key: 'HR', name: 'Nhân sự (riêng tư)' }),
      ],
    };
    const prisma = {
      client: {
        findMany: vi.fn(() => Promise.resolve([clientRow])),
        findFirst: vi.fn(() => Promise.resolve(clientRow)),
      },
      contract: { create: vi.fn(() => Promise.resolve(contract('k3', null))) },
      project: {
        findMany: vi.fn(() => Promise.resolve(found)),
        updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
      },
      $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
    };
    const access = {
      visibleWhere: vi.fn(() => Promise.resolve(visible)),
      visibleProjectIds: vi.fn(() => Promise.resolve(['pub'])),
    };
    return { service: new ClientsService(prisma as never, access as never), prisma, access };
  }

  it('list/get(…, viewer): dự án của khách hàng chỉ gồm dự án thấy được; hợp đồng gắn dự án ẩn bị loại khỏi danh sách/số đếm/tổng giá trị', async () => {
    const { service, prisma } = make();
    const [c] = await service.list('w1', 'u1');
    const sel = (
      prisma.client.findMany.mock.calls[0] as unknown as [
        { select: { projects: { where: unknown } } },
      ]
    )[0].select;
    expect(sel.projects.where).toMatchObject({ deletedAt: null, ...visible });
    // Hợp đồng gắn dự án ẩn bị LOẠI hẳn (không chỉ bỏ field project): không còn tên/mã/giá trị trong danh sách, số đếm, tổng.
    expect(c!.contracts.map((k) => k.name)).toEqual(['HĐ k1']);
    expect(c!.contractCount).toBe(1);
    expect(c!.contractTotals).toEqual([{ currency: 'VND', value: 100 }]);
    const got = await service.get('w1', 'c1', 'u1');
    expect(got.contracts.map((k) => k.name)).toEqual(['HĐ k1']);
    expect(got.contractTotals).toEqual([{ currency: 'VND', value: 100 }]);
  });

  it('setProjects: dự án người gọi không thấy → 422, không ghi; gỡ chỉ trong phạm vi thấy được', async () => {
    const hidden = make([]);
    await expect(hidden.service.setProjects('w1', 'c1', ['hr'], 'u1')).rejects.toMatchObject({
      status: 422,
    });
    expect(whereOf(hidden.prisma.project.findMany)).toMatchObject({
      id: { in: ['hr'] },
      ...visible,
    });
    expect(hidden.prisma.project.updateMany).not.toHaveBeenCalled();

    const ok = make([{ id: 'pub' }]);
    await ok.service.setProjects('w1', 'c1', ['pub'], 'u1');
    expect(whereOf(ok.prisma.project.updateMany)).toMatchObject({
      workspaceId: 'w1',
      clientId: 'c1',
      ...visible,
    });
  });

  it('createContract gắn vào dự án riêng tư không thấy → 422 như dự án ngoài workspace, không tạo', async () => {
    const { service, prisma } = make([]);
    await expect(
      service.createContract('w1', 'c1', { name: 'HĐ', projectId: 'hr' }, 'u1'),
    ).rejects.toMatchObject({ status: 422 });
    expect(prisma.contract.create).not.toHaveBeenCalled();
    expect(whereOf(prisma.project.findMany)).toMatchObject({ id: { in: ['hr'] }, ...visible });
  });

  it('listContracts(…, viewer) loại hợp đồng của dự án ẩn; sửa/xoá hợp đồng đó → 404 "Hợp đồng"', async () => {
    const { service, prisma } = make();
    (prisma as Record<string, unknown>).contract = {
      findMany: vi.fn(() =>
        Promise.resolve([
          contract('k1', { id: 'pub', key: 'PUB', name: 'Công khai' }),
          contract('k2', { id: 'hr', key: 'HR', name: 'Nhân sự' }),
        ]),
      ),
      findFirst: vi.fn((_a?: unknown) => Promise.resolve(null)),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const list = await service.listContracts('w1', 'c1', 'u1');
    expect(list.map((k) => k.name)).toEqual(['HĐ k1']);
    await expect(
      service.updateContract('w1', 'c1', 'k2', { name: 'x' }, 'u1'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.removeContract('w1', 'c1', 'k2', 'u1')).rejects.toMatchObject({
      status: 404,
    });
    const c = (prisma as unknown as { contract: { findFirst: ReturnType<typeof vi.fn> } }).contract;
    expect(whereOf(c.findFirst)).toMatchObject({
      id: 'k2',
      clientId: 'c1',
      OR: [{ projectId: null }, { project: visible }],
    });
  });
});
