import { describe, expect, it, vi } from 'vitest';
import { IssueOwnershipService, isIssueOwner } from './issue-ownership.service';

const owners = (over: Record<string, string | null> = {}) => ({
  reporterId: 'a',
  assigneeId: 'b',
  createdById: 'c',
  ...over,
});

function make(found: unknown) {
  const prisma = {
    issue: { findFirst: vi.fn((_args: unknown) => Promise.resolve(found)) },
    attachment: { findFirst: vi.fn(() => Promise.resolve(found)) },
    issueLink: { findFirst: vi.fn(() => Promise.resolve(found)) },
  };
  return { svc: new IssueOwnershipService(prisma as never), prisma };
}

describe('isIssueOwner', () => {
  it.each(['a', 'b', 'c'])('%s là chủ (reporter/assignee/createdBy)', (u) =>
    expect(isIssueOwner(u, owners())).toBe(true),
  );
  it('người khác không phải chủ', () => expect(isIssueOwner('x', owners())).toBe(false));
  it('trường null không khớp userId', () =>
    expect(
      isIssueOwner('x', owners({ reporterId: null, assigneeId: null, createdById: null })),
    ).toBe(false));
});

describe('IssueOwnershipService', () => {
  it('ownOnly=false → no-op, không đụng DB', async () => {
    const { svc, prisma } = make(owners());
    await svc.assertOwnsIssue(false, 'w1', 'x', 'i1');
    await svc.assertOwnsAttachment(false, 'w1', 'x', 'at1');
    await svc.assertOwnsLinkSource(false, 'w1', 'x', 'l1');
    expect(prisma.issue.findFirst).not.toHaveBeenCalled();
    expect(prisma.attachment.findFirst).not.toHaveBeenCalled();
    expect(prisma.issueLink.findFirst).not.toHaveBeenCalled();
  });

  it('assertOwnsIssue: việc của người khác → 403; của mình → qua; không thấy → 404; truy vấn có workspace + deletedAt:null', async () => {
    const other = make(owners());
    await expect(other.svc.assertOwnsIssue(true, 'w1', 'x', 'i1')).rejects.toMatchObject({
      status: 403,
    });
    expect(other.prisma.issue.findFirst.mock.calls[0]![0]).toMatchObject({
      where: { id: 'i1', workspaceId: 'w1', deletedAt: null },
    });
    await expect(
      make(owners()).svc.assertOwnsIssue(true, 'w1', 'b', 'i1'),
    ).resolves.toBeUndefined();
    await expect(make(null).svc.assertOwnsIssue(true, 'w1', 'b', 'i1')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('assertOwnsAttachment: lấy issue trực tiếp hoặc issue của comment', async () => {
    await expect(
      make({ issue: owners(), comment: null }).svc.assertOwnsAttachment(true, 'w1', 'x', 'at1'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      make({ issue: null, comment: { issue: owners() } }).svc.assertOwnsAttachment(
        true,
        'w1',
        'a',
        'at1',
      ),
    ).resolves.toBeUndefined();
    await expect(
      make({ issue: null, comment: null }).svc.assertOwnsAttachment(true, 'w1', 'a', 'at1'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('assertOwnsLinkSource: kiểm đầu nguồn', async () => {
    await expect(
      make({ source: owners() }).svc.assertOwnsLinkSource(true, 'w1', 'x', 'l1'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      make({ source: owners() }).svc.assertOwnsLinkSource(true, 'w1', 'c', 'l1'),
    ).resolves.toBeUndefined();
  });
});
