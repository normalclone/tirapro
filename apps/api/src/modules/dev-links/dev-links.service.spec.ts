import { describe, expect, it, vi } from 'vitest';
import { DevLinksService } from './dev-links.service';

/** Webhook GitLab (token = secret) với một commit nhắc mã DEMO-1; issue nằm ở dự án `archived` hoặc đang hoạt động. */
function setup(project: { archivedAt: Date | null; deletedAt: Date | null }) {
  const prisma = {
    codeRepository: {
      findUnique: vi.fn(() =>
        Promise.resolve({
          id: 'r1',
          workspaceId: 'w1',
          webhookSecret: 's3cret',
          isEnabled: true,
          provider: 'GITLAB',
        }),
      ),
    },
    issue: {
      // Giả lập lọc quan hệ project như Prisma: issue chỉ khớp khi dự án thoả mọi điều kiện `where.project`.
      findFirst: vi.fn(({ where }: { where: { project?: Record<string, null> } }) => {
        const w = where.project ?? {};
        const ok =
          (!('archivedAt' in w) || project.archivedAt === w.archivedAt) &&
          (!('deletedAt' in w) || project.deletedAt === w.deletedAt);
        return Promise.resolve(ok ? { id: 'i1' } : null);
      }),
    },
    issueDevLink: {
      findFirst: vi.fn(() => Promise.resolve(null)),
      create: vi.fn(() => Promise.resolve({ id: 'd1' })),
    },
  };
  return { service: new DevLinksService(prisma as never), prisma };
}

const payload = { commits: [{ id: 'abc123', message: 'DEMO-1 sửa lỗi' }] };
const auth = { rawBody: Buffer.from('{}'), gitlabToken: 's3cret' } as never;

describe('DevLinksService.handleWebhook — dự án lưu trữ là chỉ đọc', () => {
  it('issue của dự án đã lưu trữ bị bỏ qua im lặng: linked 0, không ghi IssueDevLink, không lỗi', async () => {
    const { service, prisma } = setup({ archivedAt: new Date(), deletedAt: null });
    await expect(service.handleWebhook('r1', auth, payload as never)).resolves.toEqual({
      linked: 0,
      matched: ['DEMO-1'],
    });
    expect(prisma.issueDevLink.create).not.toHaveBeenCalled();
  });

  it('issue của dự án đang hoạt động vẫn được gắn dev-link', async () => {
    const { service, prisma } = setup({ archivedAt: null, deletedAt: null });
    const res = await service.handleWebhook('r1', auth, payload);
    expect(res.linked).toBe(1);
    expect(prisma.issueDevLink.create).toHaveBeenCalledTimes(1);
  });
});
