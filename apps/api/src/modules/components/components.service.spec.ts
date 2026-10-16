import { describe, expect, it, vi } from 'vitest';
import { DOMAIN_EVENTS } from '@tirapro/types';
import { ComponentsService } from './components.service';

const ARCHIVED = { status: 422, message: expect.stringContaining('lưu trữ') as unknown };

function setup(archived: boolean) {
  const prisma = {
    project: {
      findFirst: vi.fn(() => Promise.resolve({ id: 'p1' })),
      findUnique: vi.fn(() => Promise.resolve({ archivedAt: archived ? new Date() : null })),
    },
    component: {
      findFirst: vi.fn(() => Promise.resolve({ id: 'c1', projectId: 'p1' })),
      create: vi.fn(() => Promise.resolve({})),
      update: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
    },
    version: {
      findFirst: vi.fn(() => Promise.resolve({ id: 'v1', projectId: 'p1' })),
      create: vi.fn(() => Promise.resolve({})),
      update: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
    },
  };
  const events = { emit: vi.fn() };
  return { service: new ComponentsService(prisma as never, events as never), prisma, events };
}

describe('ComponentsService — hạng mục/phiên bản của dự án lưu trữ là chỉ đọc', () => {
  it('create/update/remove component => 422, không ghi', async () => {
    const { service, prisma } = setup(true);
    await expect(service.createComponent('w1', 'p1', { name: 'C' })).rejects.toMatchObject(
      ARCHIVED,
    );
    await expect(service.updateComponent('w1', 'c1', { name: 'Mới' })).rejects.toMatchObject(
      ARCHIVED,
    );
    await expect(service.removeComponent('w1', 'c1')).rejects.toMatchObject(ARCHIVED);
    expect(prisma.component.create).not.toHaveBeenCalled();
    expect(prisma.component.update).not.toHaveBeenCalled();
    expect(prisma.component.delete).not.toHaveBeenCalled();
  });

  it('create/update/remove version => 422, không ghi', async () => {
    const { service, prisma } = setup(true);
    await expect(service.createVersion('w1', 'p1', { name: 'v1' })).rejects.toMatchObject(ARCHIVED);
    await expect(service.updateVersion('w1', 'v1', { name: 'v2' })).rejects.toMatchObject(ARCHIVED);
    await expect(service.removeVersion('w1', 'v1')).rejects.toMatchObject(ARCHIVED);
    expect(prisma.version.create).not.toHaveBeenCalled();
    expect(prisma.version.update).not.toHaveBeenCalled();
    expect(prisma.version.delete).not.toHaveBeenCalled();
  });

  it('dự án đang hoạt động => ghi bình thường', async () => {
    const { service, prisma } = setup(false);
    prisma.component.update.mockResolvedValue({ id: 'c1', projectId: 'p1', name: 'x' });
    await service.updateComponent('w1', 'c1', { name: 'x' });
    await service.removeVersion('w1', 'v1');
    expect(prisma.component.update).toHaveBeenCalledOnce();
    expect(prisma.version.delete).toHaveBeenCalledOnce();
  });
});

/** `expect.objectContaining` trả `any` — bọc kiểu `unknown` để qua no-unsafe-assignment. */
const has = (o: Record<string, unknown>): unknown => expect.objectContaining(o);

describe('ComponentsService — gắn/bỏ thành phần/phiên bản của công việc (M3)', () => {
  function setupIssue() {
    const tx = {
      issueComponent: {
        create: vi.fn(() => Promise.resolve({})),
        deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
      issueFixVersion: {
        create: vi.fn(() => Promise.resolve({})),
        deleteMany: vi.fn(() => Promise.resolve({ count: 1 })),
      },
      issueHistory: { create: vi.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      issue: {
        findFirst: vi.fn((args: { select?: Record<string, unknown> }) =>
          Promise.resolve(
            args.select?.components
              ? {
                  id: 'i1',
                  key: 'P-1',
                  projectId: 'p1',
                  components: [{ component: { id: 'c1', name: 'API' } }],
                  fixVersions: [{ type: 'FIX', version: { id: 'v1', name: 'v1.0' } }],
                }
              : { id: 'i1', projectId: 'p1', sprintId: 's1' },
          ),
        ),
        findUnique: vi.fn(() => Promise.resolve({ project: { archivedAt: null } })),
      },
      component: { findFirst: vi.fn(() => Promise.resolve({ id: 'c1', name: 'API' })) },
      version: { findFirst: vi.fn(() => Promise.resolve({ id: 'v1', name: 'v1.0' })) },
      project: { findUnique: vi.fn(() => Promise.resolve({ archivedAt: null })) },
      $transaction: (fn: (t: unknown) => unknown) => fn(tx),
    };
    const events = { emit: vi.fn() };
    return { service: new ComponentsService(prisma as never, events as never), tx, events };
  }

  it('gắn thành phần: ghi lịch sử COMPONENT (cũ null → tên) và phát ISSUE_SETS_CHANGED kèm tập đầy đủ', async () => {
    const { service, tx, events } = setupIssue();
    await service.attachComponent('w1', 'u1', 'i1', 'c1');
    expect(tx.issueHistory.create).toHaveBeenCalledWith({
      data: has({
        field: 'COMPONENT',
        oldValue: null,
        newValue: 'API',
        actorId: 'u1',
        issueId: 'i1',
        projectId: 'p1',
        sprintId: 's1',
      }),
    });
    expect(events.emit).toHaveBeenCalledWith(DOMAIN_EVENTS.ISSUE_SETS_CHANGED, {
      issueId: 'i1',
      issueKey: 'P-1',
      projectId: 'p1',
      components: [{ id: 'c1', name: 'API' }],
      fixVersions: [{ id: 'v1', name: 'v1.0', type: 'FIX' }],
    });
  });

  it('gắn trùng (P2002) => idempotent: không phát sự kiện', async () => {
    const { service, tx, events } = setupIssue();
    const { Prisma } = await import('@prisma/client');
    tx.issueComponent.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(service.attachComponent('w1', 'u1', 'i1', 'c1')).resolves.toEqual({ ok: true });
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('bỏ thành phần: ghi lịch sử (tên → null); bỏ cái chưa gắn (count 0) => không ghi, không phát', async () => {
    const { service, tx, events } = setupIssue();
    await service.detachComponent('w1', 'u1', 'i1', 'c1');
    expect(tx.issueHistory.create).toHaveBeenCalledWith({
      data: has({ field: 'COMPONENT', oldValue: 'API', newValue: null }),
    });
    expect(events.emit).toHaveBeenCalledTimes(1);
    tx.issueComponent.deleteMany.mockResolvedValueOnce({ count: 0 });
    tx.issueHistory.create.mockClear();
    events.emit.mockClear();
    await service.detachComponent('w1', 'u1', 'i1', 'c1');
    expect(tx.issueHistory.create).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('phiên bản: lịch sử FIX_VERSION mang loại (FIX:/AFFECTS:) ở cả gắn lẫn bỏ', async () => {
    const { service, tx } = setupIssue();
    await service.attachVersion('w1', 'u1', 'i1', 'v1', 'AFFECTS');
    expect(tx.issueHistory.create).toHaveBeenLastCalledWith({
      data: has({
        field: 'FIX_VERSION',
        oldValue: null,
        newValue: 'AFFECTS:v1.0',
      }),
    });
    await service.detachVersion('w1', 'u1', 'i1', 'v1', 'FIX');
    expect(tx.issueHistory.create).toHaveBeenLastCalledWith({
      data: has({ field: 'FIX_VERSION', oldValue: 'FIX:v1.0', newValue: null }),
    });
  });
});
