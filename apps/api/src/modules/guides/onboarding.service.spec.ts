import { describe, expect, it, vi } from 'vitest';
import { OnboardingService } from './onboarding.service';

function make(
  counts: { project: number; members: number; sprint: number; telegram: number },
  over: { dismissed?: boolean; createdDaysAgo?: number; guide?: unknown } = {},
) {
  const prisma = {
    guide: {
      findFirst: vi.fn((..._a: unknown[]) =>
        Promise.resolve(
          'guide' in over
            ? over.guide
            : {
                key: 'onboarding-start',
                content: {
                  items: [
                    { key: 'create_project', label: 'Tạo dự án', href: null },
                    { key: 'add_members', label: 'Thêm thành viên', href: '/members' },
                    { key: 'start_sprint', label: 'Bắt đầu Sprint', href: null },
                    {
                      key: 'connect_telegram',
                      label: 'Kết nối Telegram',
                      href: '/connect/integrations',
                    },
                  ],
                },
              },
        ),
      ),
    },
    project: { count: vi.fn((..._a: unknown[]) => Promise.resolve(counts.project)) },
    workspaceMembership: { count: vi.fn((..._a: unknown[]) => Promise.resolve(counts.members)) },
    sprint: { count: vi.fn((..._a: unknown[]) => Promise.resolve(counts.sprint)) },
    integration: { count: vi.fn((..._a: unknown[]) => Promise.resolve(counts.telegram)) },
    workspace: {
      findFirst: vi.fn((..._a: unknown[]) =>
        Promise.resolve({
          createdAt: new Date(Date.now() - (over.createdDaysAgo ?? 1) * 86_400_000),
        }),
      ),
    },
    userGuideState: {
      findUnique: vi.fn((..._a: unknown[]) =>
        Promise.resolve(over.dismissed ? { state: 'DISMISSED' } : null),
      ),
      upsert: vi.fn((..._a: unknown[]) => Promise.resolve({})),
    },
  };
  return { svc: new OnboardingService(prisma as never), prisma };
}

describe('OnboardingService.get', () => {
  it('workspace mới tinh: 0/4, hiện khối', async () => {
    const out = await make({ project: 0, members: 1, sprint: 0, telegram: 0 }).svc.get('u1', 'w1');
    expect(out).toMatchObject({ doneCount: 0, total: 4, dismissed: false, visible: true });
    expect(out.items.map((i) => i.done)).toEqual([false, false, false, false]);
    expect(out.items.map((i) => i.key)).toEqual([
      'create_project',
      'add_members',
      'start_sprint',
      'connect_telegram',
    ]);
  });

  it('đánh dấu xong từng mục từ dữ liệu thật', async () => {
    const out = await make({ project: 2, members: 3, sprint: 0, telegram: 1 }).svc.get('u1', 'w1');
    expect(out.items.map((i) => i.done)).toEqual([true, true, false, true]);
    expect(out.doneCount).toBe(3);
  });

  it('xong cả 4 → visible=false; đã ẩn → visible=false; workspace > 30 ngày → visible=false', async () => {
    expect(
      (await make({ project: 1, members: 2, sprint: 1, telegram: 1 }).svc.get('u1', 'w1')).visible,
    ).toBe(false);
    expect(
      (
        await make({ project: 0, members: 1, sprint: 0, telegram: 0 }, { dismissed: true }).svc.get(
          'u1',
          'w1',
        )
      ).visible,
    ).toBe(false);
    expect(
      (
        await make(
          { project: 0, members: 1, sprint: 0, telegram: 0 },
          { createdDaysAgo: 40 },
        ).svc.get('u1', 'w1')
      ).visible,
    ).toBe(false);
  });

  it('dự án đã xoá mềm không tính; kênh Telegram phải đang bật; sprint chỉ ACTIVE/CLOSED còn sống', async () => {
    const { svc, prisma } = make({ project: 0, members: 1, sprint: 0, telegram: 0 });
    await svc.get('u1', 'w1');
    const where = (m: { mock: { calls: unknown[][] } }) =>
      (m.mock.calls[0] as unknown as [{ where: unknown }])[0].where;
    expect(where(prisma.project.count)).toMatchObject({ workspaceId: 'w1', deletedAt: null });
    // tài khoản đã vô hiệu hoá không tính là "đã thêm thành viên"
    expect(where(prisma.workspaceMembership.count)).toEqual({
      workspaceId: 'w1',
      user: { status: { not: 'DEACTIVATED' } },
    });
    expect(where(prisma.integration.count)).toMatchObject({
      type: 'TELEGRAM',
      status: 'ACTIVE',
      channels: { some: { isEnabled: true } },
    });
    expect(where(prisma.sprint.count)).toMatchObject({
      deletedAt: null,
      state: { in: ['ACTIVE', 'CLOSED'] },
      project: { workspaceId: 'w1', deletedAt: null },
    });
  });

  it('lấy nhãn/đường dẫn từ Guide (bản workspace trước bản toàn cục); bỏ khoá lạ trong DB', async () => {
    const { svc, prisma } = make(
      { project: 0, members: 1, sprint: 0, telegram: 0 },
      {
        guide: {
          key: 'onboarding-start',
          content: {
            items: [
              { key: 'create_project', label: 'Dự án đầu tiên của bạn', href: null },
              { key: 'khong_co_logic', label: 'Lạ', href: '/x' },
            ],
          },
        },
      },
    );
    const out = await svc.get('u1', 'w1');
    expect(prisma.guide.findFirst.mock.calls[0]![0]).toMatchObject({
      where: {
        key: 'onboarding-start',
        isPublished: true,
        OR: [{ workspaceId: 'w1' }, { workspaceId: null }],
      },
      orderBy: { workspaceId: { sort: 'desc', nulls: 'last' } },
    });
    expect(out.items.map((i) => i.key)).toEqual(['create_project']);
    expect(out.items[0]!.label).toBe('Dự án đầu tiên của bạn');
    expect(out.total).toBe(1);
  });

  it('thiếu bản ghi Guide (chưa nạp) → rơi về nội dung mặc định trong mã, vẫn đủ 4 mục', async () => {
    const out = await make(
      { project: 0, members: 1, sprint: 0, telegram: 0 },
      { guide: null },
    ).svc.get('u1', 'w1');
    expect(out.total).toBe(4);
  });
});

describe('OnboardingService.dismiss', () => {
  it('ghi UserGuideState onboarding-start = DISMISSED cho đúng người dùng', async () => {
    const { svc, prisma } = make({ project: 0, members: 1, sprint: 0, telegram: 0 });
    await expect(svc.dismiss('u1')).resolves.toEqual({ ok: true });
    expect(prisma.userGuideState.upsert.mock.calls[0]![0]).toMatchObject({
      where: { userId_guideKey: { userId: 'u1', guideKey: 'onboarding-start' } },
      create: { userId: 'u1', guideKey: 'onboarding-start', state: 'DISMISSED' },
      update: { state: 'DISMISSED' },
    });
  });
});
