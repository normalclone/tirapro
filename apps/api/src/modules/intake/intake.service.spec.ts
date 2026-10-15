import { describe, expect, it, vi } from 'vitest';
import { IntakeService } from './intake.service';

function make(
  over: {
    existing?: unknown[];
    similar?: string[];
    types?: Record<string, string>;
    archivedAt?: Date | null;
  } = {},
) {
  const project = { id: 'p1', archivedAt: over.archivedAt ?? null };
  const issueUpdate = vi.fn(() =>
    Promise.resolve({ id: 'old1', key: 'DEMO-BUG-2', occurrenceCount: 2 }),
  );
  const prisma = {
    project: { findFirst: vi.fn(() => Promise.resolve(project)) },
    issue: {
      findMany: vi.fn(() => Promise.resolve(over.existing ?? [])),
      findFirst: vi.fn(() =>
        Promise.resolve({ id: 'old1', key: 'DEMO-BUG-2', projectId: 'p1', severityId: null }),
      ),
      update: issueUpdate,
    },
    issueType: {
      findFirst: vi.fn(({ where }: { where: { key?: string } }) =>
        Promise.resolve({ id: over.types?.[where.key ?? ''] ?? 'tBug' }),
      ),
    },
    issueWatcher: { createMany: vi.fn(() => Promise.resolve({ count: 1 })) },
    attachment: { findMany: vi.fn(() => Promise.resolve([])) },
    severity: { findFirst: vi.fn(() => Promise.resolve({ name: 'Critical' })) },
    user: { findUnique: vi.fn(() => Promise.resolve({ displayName: 'Trang' })) },
    $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(prisma)),
  };
  const issues = { create: vi.fn(() => Promise.resolve({ id: 'new1', key: 'DEMO-BUG-7' })) };
  const comments = { create: vi.fn((..._a: unknown[]) => Promise.resolve({ id: 'c1' })) };
  const search = { similarIssueIds: vi.fn(() => Promise.resolve(over.similar ?? [])) };
  const service = new IntakeService(
    prisma as never,
    issues as never,
    comments as never,
    search as never,
  );
  return { service, prisma, issues, comments, search, issueUpdate };
}
const live = {
  id: 'old1',
  key: 'DEMO-BUG-2',
  summary: 'Giỏ hàng bị mất sản phẩm',
  occurrenceCount: 1,
  triageState: 'PENDING',
  version: 1,
  status: { category: 'TODO' },
};

describe('IntakeService.report', () => {
  it('tiêu đề giống hệt (bỏ dấu/hoa thường) mà client không chọn gì => gộp NHƯNG lưu mô tả mới thành bình luận + người báo thành watcher', async () => {
    const { service, comments, prisma, issues } = make({ existing: [live], similar: ['old1'] });
    const r = await service.report('w1', 'u9', {
      projectId: 'p1',
      kind: 'BUG',
      summary: 'GIO HANG bi mat   san pham',
      description: 'Trên Android cũng bị',
    });
    expect(r).toMatchObject({ deduped: true, issueId: 'old1', merged: 'auto', commentId: 'c1' });
    expect(comments.create).toHaveBeenCalledWith(
      'w1',
      'u9',
      'old1',
      expect.objectContaining({
        bodyFormat: 'MARKDOWN',
        body: expect.stringContaining('Trên Android cũng bị') as string,
      }),
    );
    expect(prisma.issueWatcher.createMany).toHaveBeenCalledWith({
      data: [{ issueId: 'old1', userId: 'u9' }],
      skipDuplicates: true,
    });
    expect(issues.create).not.toHaveBeenCalled();
  });

  it('bug trùng đã Done (không còn chờ triage) thì KHÔNG gộp tự động — tạo mới', async () => {
    const done = { ...live, triageState: 'ACCEPTED', status: { category: 'DONE' } };
    const { service, issues, comments } = make({ existing: [done], similar: ['old1'] });
    const r = await service.report('w1', 'u9', {
      projectId: 'p1',
      kind: 'BUG',
      summary: 'Giỏ hàng bị mất sản phẩm',
    });
    expect(r).toMatchObject({ deduped: false, issueId: 'new1' });
    expect(issues.create).toHaveBeenCalledTimes(1);
    expect(comments.create).not.toHaveBeenCalled();
  });

  it('mergeIntoIssueId tường minh: gộp vào bug đã chọn kể cả khi tiêu đề khác, đính ảnh đúng bug', async () => {
    const { service, comments, prisma } = make();
    prisma.attachment.findMany.mockResolvedValueOnce([
      { id: 'a1', fileName: 'x.png', mimeType: 'image/png' },
    ] as never);
    const r = await service.report('w1', 'u9', {
      projectId: 'p1',
      kind: 'BUG',
      summary: 'Khác hẳn',
      mergeIntoIssueId: 'old1',
      attachmentIds: ['a1', 'zzz'],
    });
    expect(r).toMatchObject({ deduped: true, merged: 'chosen' });
    expect(prisma.attachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['a1', 'zzz'] },
          issueId: 'old1',
          uploadedById: 'u9',
        }) as unknown,
      }),
    );
    const body = (comments.create.mock.calls[0]![3] as { body: string }).body;
    expect(body).toContain('![x.png](attachment:a1)');
  });

  it('mergeIntoIssueId không thuộc dự án => 404, không ghi gì', async () => {
    const { service, prisma, comments } = make();
    prisma.issue.findFirst.mockResolvedValueOnce(null as never);
    await expect(
      service.report('w1', 'u9', {
        projectId: 'p1',
        kind: 'BUG',
        summary: 'Khác hẳn',
        mergeIntoIssueId: 'other',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(comments.create).not.toHaveBeenCalled();
  });

  it('mức nghiêm trọng đề xuất khác mức hiện tại thì có trong ghi chú', async () => {
    const { service, comments } = make();
    await service.report('w1', 'u9', {
      projectId: 'p1',
      kind: 'BUG',
      summary: 'Khác hẳn',
      mergeIntoIssueId: 'old1',
      severityId: 'sv9',
    });
    const body = (comments.create.mock.calls[0]![3] as { body: string }).body;
    expect(body).toContain('**Mức nghiêm trọng đề xuất:** Critical');
  });

  it('thiếu quyền bình luận: gộp có chọn bị 403; trùng tiêu đề thì tạo mới thay vì mất chữ', async () => {
    const a = make({ existing: [live], similar: ['old1'] });
    await expect(
      a.service.report(
        'w1',
        'u9',
        { projectId: 'p1', kind: 'BUG', summary: 'Khác hẳn', mergeIntoIssueId: 'old1' },
        { canComment: false },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(a.comments.create).not.toHaveBeenCalled();

    const b = make({ existing: [live], similar: ['old1'] });
    const r = await b.service.report(
      'w1',
      'u9',
      { projectId: 'p1', kind: 'BUG', summary: 'Giỏ hàng bị mất sản phẩm' },
      { canComment: false },
    );
    expect(r).toMatchObject({ deduped: false, issueId: 'new1' });
    expect(b.comments.create).not.toHaveBeenCalled();
  });

  it('forceNew: cùng tiêu đề vẫn tạo bug mới, không gộp', async () => {
    const { service, issues, comments } = make({ existing: [live], similar: ['old1'] });
    const r = await service.report('w1', 'u9', {
      projectId: 'p1',
      kind: 'BUG',
      summary: 'Giỏ hàng bị mất sản phẩm',
      forceNew: true,
    });
    expect(r).toEqual({ deduped: false, issueId: 'new1', key: 'DEMO-BUG-7' });
    expect(issues.create).toHaveBeenCalledTimes(1);
    expect(comments.create).not.toHaveBeenCalled();
  });
});

describe('IntakeService.report — loại yêu cầu', () => {
  it('kind FEATURE => loại Story, severity/môi trường chuyển cho IssuesService.create, triageSource lưu kind, người báo thành watcher', async () => {
    const { service, issues, issueUpdate, prisma } = make({ types: { STORY: 'tStory' } });
    await service.report('w1', 'u9', {
      projectId: 'p1',
      kind: 'FEATURE',
      summary: 'Cho phép đăng nhập Zalo',
      severityId: 'sv1',
      environment: { browser: 'Chrome 126' },
    });
    expect(issues.create).toHaveBeenCalledWith(
      'w1',
      'u9',
      expect.objectContaining({
        typeId: 'tStory',
        severityId: 'sv1',
        environment: { browser: 'Chrome 126' },
      }),
    );
    expect(issueUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triageState: 'PENDING',
          triageSource: 'FEATURE',
          occurrenceCount: 1,
        }) as unknown,
      }),
    );
    expect(prisma.issueWatcher.createMany).toHaveBeenCalledWith({
      data: [{ issueId: 'new1', userId: 'u9' }],
      skipDuplicates: true,
    });
  });

  it('typeId tường minh thắng loại theo kind', async () => {
    const { service, issues, prisma } = make();
    await service.report('w1', 'u9', {
      projectId: 'p1',
      kind: 'FEATURE',
      summary: 'Cho phép đăng nhập Zalo',
      typeId: 'tCustom',
    });
    expect(prisma.issueType.findFirst).not.toHaveBeenCalled();
    expect(issues.create).toHaveBeenCalledWith(
      'w1',
      'u9',
      expect.objectContaining({ typeId: 'tCustom' }),
    );
  });

  it('dự án đã lưu trữ => chặn trước mọi ghi', async () => {
    const { service, issues, comments, prisma } = make({ archivedAt: new Date() });
    await expect(
      service.report('w1', 'u9', { projectId: 'p1', kind: 'BUG', summary: 'Giỏ hàng bị mất' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(issues.create).not.toHaveBeenCalled();
    expect(comments.create).not.toHaveBeenCalled();
    expect(prisma.issue.update).not.toHaveBeenCalled();
  });
});

describe('IntakeService.findDuplicates', () => {
  it('lấy id từ tìm kiếm bỏ dấu (xếp hạng), giữ thứ tự, đánh dấu bug đã đóng, không đọc toàn dự án', async () => {
    const { service, prisma, search } = make();
    search.similarIssueIds.mockResolvedValueOnce(['b', 'a']);
    prisma.issue.findMany.mockResolvedValueOnce([
      {
        id: 'a',
        key: 'D-1',
        summary: 'A',
        occurrenceCount: 1,
        triageState: null,
        status: { name: 'Done', category: 'DONE' },
        resolution: { name: "Won't Do" },
        severity: null,
        reporter: { displayName: 'X' },
        createdAt: new Date(),
      },
      {
        id: 'b',
        key: 'D-2',
        summary: 'B',
        occurrenceCount: 3,
        triageState: 'PENDING',
        status: { name: 'To Do', category: 'TODO' },
        resolution: null,
        severity: { id: 's', name: 'Major', color: null },
        reporter: null,
        createdAt: new Date(),
      },
    ] as never);
    const out = await service.findDuplicates('w1', 'p1', 'gio hang');
    expect(search.similarIssueIds).toHaveBeenCalledWith('w1', 'p1', 'gio hang', 8);
    expect(out.map((o) => o.id)).toEqual(['b', 'a']);
    expect(out[1]).toMatchObject({ closed: true, resolution: "Won't Do", reporterName: 'X' });
    expect(out[0]).toMatchObject({
      closed: false,
      severity: { name: 'Major' },
      reporterName: null,
    });
    expect(prisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['b', 'a'] },
          projectId: 'p1',
          deletedAt: null,
        }) as unknown,
      }),
    );
  });

  it('truy vấn dưới 3 ký tự => [] và không gọi tìm kiếm', async () => {
    const { service, search } = make();
    expect(await service.findDuplicates('w1', 'p1', '  ab ')).toEqual([]);
    expect(search.similarIssueIds).not.toHaveBeenCalled();
  });

  it('không có kết quả tìm kiếm => [] và không đọc issue', async () => {
    const { service, prisma } = make({ similar: [] });
    expect(await service.findDuplicates('w1', 'p1', 'khong co gi')).toEqual([]);
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });
});
