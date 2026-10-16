import { describe, expect, it, vi } from 'vitest';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { IntakeService } from './intake.service';

function make(
  over: {
    existing?: unknown[];
    similar?: string[];
    types?: Record<string, string>;
    archivedAt?: Date | null;
    redis?: unknown;
    targetState?: string | null;
  } = {},
) {
  const project = { id: 'p1', archivedAt: over.archivedAt ?? null };
  const issueUpdate = vi.fn((_a: unknown) =>
    Promise.resolve({ id: 'old1', key: 'DEMO-BUG-2', occurrenceCount: 2 }),
  );
  const prisma = {
    project: { findFirst: vi.fn(() => Promise.resolve(project)) },
    issue: {
      findMany: vi.fn(() => Promise.resolve(over.existing ?? [])),
      findFirst: vi.fn(() =>
        Promise.resolve({
          id: 'old1',
          key: 'DEMO-BUG-2',
          projectId: 'p1',
          severityId: null,
          triageState: over.targetState ?? null,
        }),
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
  const search = {
    similarIssueIds: vi.fn((..._a: unknown[]) => Promise.resolve(over.similar ?? [])),
    assertProjectVisibleTo: vi.fn((..._a: unknown[]) => Promise.resolve()),
  };
  const service = new IntakeService(
    prisma as never,
    issues as never,
    comments as never,
    search as never,
    over.redis as never,
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

describe('IntakeService.report — chịu lỗi và chống gửi đôi', () => {
  it('tìm kiếm trùng ném lỗi => không 500: ghi log rồi tạo bug mới (báo lỗi không bao giờ mất)', async () => {
    const { service, search, issues, comments } = make();
    search.similarIssueIds.mockRejectedValueOnce(new Error('canceling statement due to timeout'));
    const r = await service.report('w1', 'u9', {
      projectId: 'p1',
      kind: 'BUG',
      summary: 'Giỏ hàng bị mất sản phẩm',
      description: 'Mô tả vẫn được giữ',
    });
    expect(r).toEqual({ deduped: false, issueId: 'new1', key: 'DEMO-BUG-7' });
    expect(issues.create).toHaveBeenCalledWith(
      'w1',
      'u9',
      expect.objectContaining({ description: 'Mô tả vẫn được giữ' }),
    );
    expect(comments.create).not.toHaveBeenCalled();
  });

  it('đọc ứng viên (issue.findMany) lỗi cũng chỉ bỏ qua dò trùng', async () => {
    const { service, prisma, issues } = make({ similar: ['old1'] });
    prisma.issue.findMany.mockRejectedValueOnce(new Error('db tạm'));
    const r = await service.report('w1', 'u9', {
      projectId: 'p1',
      kind: 'BUG',
      summary: 'Giỏ hàng bị mất sản phẩm',
    });
    expect(r).toMatchObject({ deduped: false });
    expect(issues.create).toHaveBeenCalledTimes(1);
  });

  it('gửi đôi cùng nội dung (kể cả khi lần đầu còn chạy) chỉ tạo MỘT bug; lỗi thì thử lại được', async () => {
    const { service, issues } = make();
    const input = { projectId: 'p1', kind: 'BUG' as const, summary: 'Nút Lưu không phản hồi' };
    const [a, b] = await Promise.all([
      service.report('w1', 'u9', input),
      service.report('w1', 'u9', { ...input }),
    ]);
    expect(a).toEqual(b);
    expect(issues.create).toHaveBeenCalledTimes(1);
    // người khác / nội dung khác thì vẫn tạo riêng
    await service.report('w1', 'u8', input);
    await service.report('w1', 'u9', { ...input, description: 'khác' });
    expect(issues.create).toHaveBeenCalledTimes(3);
  });

  it('báo lỗi thất bại thì lần gửi lại không bị chặn bởi khoá chống gửi đôi', async () => {
    const { service, issues } = make();
    issues.create.mockRejectedValueOnce(new Error('boom'));
    const input = { projectId: 'p1', kind: 'BUG' as const, summary: 'Nút Lưu không phản hồi' };
    await expect(service.report('w1', 'u9', input)).rejects.toThrow('boom');
    await expect(service.report('w1', 'u9', input)).resolves.toMatchObject({ deduped: false });
  });

  it('yêu cầu tính năng trùng tiêu đề một Bug sống KHÔNG bị gộp tự động', async () => {
    const { service, issues, comments } = make({ existing: [live], similar: ['old1'] });
    const r = await service.report('w1', 'u9', {
      projectId: 'p1',
      kind: 'FEATURE',
      summary: 'Giỏ hàng bị mất sản phẩm',
    });
    expect(r).toMatchObject({ deduped: false });
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
    const out = await service.findDuplicates('w1', 'p1', 'gio hang', 'u1');
    expect(search.similarIssueIds).toHaveBeenCalledWith('w1', 'p1', 'gio hang', 'u1', 8);
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

  it('dự án riêng tư người báo không thấy => 404 như dự án không tồn tại, kể cả tiêu đề quá ngắn; không gọi tìm kiếm (P13)', async () => {
    const { service, search } = make();
    search.assertProjectVisibleTo.mockRejectedValue(new NotFoundAppException('Dự án'));
    await expect(service.findDuplicates('w1', 'p1', 'ab', 'u1')).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.findDuplicates('w1', 'p1', 'gio hang', 'u1')).rejects.toMatchObject({
      status: 404,
    });
    expect(search.assertProjectVisibleTo).toHaveBeenCalledWith('u1', 'w1', 'p1');
    expect(search.similarIssueIds).not.toHaveBeenCalled();
  });

  it('truy vấn dưới 3 ký tự => [] và không gọi tìm kiếm', async () => {
    const { service, search } = make();
    expect(await service.findDuplicates('w1', 'p1', '  ab ', 'u0')).toEqual([]);
    expect(search.similarIssueIds).not.toHaveBeenCalled();
  });

  it('không có kết quả tìm kiếm => [] và không đọc issue', async () => {
    const { service, prisma } = make({ similar: [] });
    expect(await service.findDuplicates('w1', 'p1', 'khong co gi', 'u0')).toEqual([]);
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });
});

/** Redis giả đủ cho khoá chống gửi đôi: SET NX EX / GET / DEL trên một Map dùng chung giữa các "node". */
function fakeRedis(store = new Map<string, string>(), available = true) {
  const client = {
    set: vi.fn((k: string, v: string, ...args: unknown[]): Promise<string | null> => {
      if (args.includes('NX') && store.has(k)) return Promise.resolve(null);
      store.set(k, v);
      return Promise.resolve('OK');
    }),
    get: vi.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    del: vi.fn((k: string) => Promise.resolve(store.delete(k) ? 1 : 0)),
  };
  return { store, client, service: { isAvailable: () => available, getClient: () => client } };
}
const dupInput = { projectId: 'p1', kind: 'BUG' as const, summary: 'Nút Lưu không phản hồi' };

describe('IntakeService.report — chống gửi đôi qua Redis (SET NX EX 8)', () => {
  it('lấy khoá bằng SET NX EX 8, chạy xong lưu kết quả để node khác dùng chung', async () => {
    const r = fakeRedis();
    const { service, issues } = make({ redis: r.service });
    const out = await service.report('w1', 'u9', dupInput);
    expect(out).toMatchObject({ deduped: false, issueId: 'new1' });
    expect(issues.create).toHaveBeenCalledTimes(1);
    const [key, , ex, ttl, nx] = r.client.set.mock.calls[0] as unknown as [
      string,
      string,
      string,
      number,
      string,
    ];
    expect(key.startsWith('intake:report:')).toBe(true);
    expect([ex, ttl, nx]).toEqual(['EX', 8, 'NX']);
    expect(JSON.parse(r.store.get(key)!)).toMatchObject({ issueId: 'new1' });
  });

  it('node KHÁC gửi cùng nội dung trong 8 giây => dùng kết quả của node đầu, không tạo bug thứ hai', async () => {
    const r = fakeRedis();
    const a = make({ redis: r.service });
    const b = make({ redis: r.service }); // instance khác: bộ nhớ riêng, Redis chung
    const first = await a.service.report('w1', 'u9', dupInput);
    const second = await b.service.report('w1', 'u9', dupInput);
    expect(second).toEqual(first);
    expect(b.issues.create).not.toHaveBeenCalled();
  });

  it('node khác gửi khi node đầu còn đang chạy => chờ rồi nhận cùng kết quả', async () => {
    const r = fakeRedis();
    const a = make({ redis: r.service });
    const b = make({ redis: r.service });
    const [x, y] = await Promise.all([
      a.service.report('w1', 'u9', dupInput),
      b.service.report('w1', 'u9', dupInput),
    ]);
    expect(y).toEqual(x);
    expect(a.issues.create.mock.calls.length + b.issues.create.mock.calls.length).toBe(1);
  });

  it('lần đầu lỗi => xoá khoá, lần gửi lại (kể cả node khác) chạy được', async () => {
    const r = fakeRedis();
    const a = make({ redis: r.service });
    const b = make({ redis: r.service });
    a.issues.create.mockRejectedValueOnce(new Error('boom'));
    await expect(a.service.report('w1', 'u9', dupInput)).rejects.toThrow('boom');
    expect(r.store.size).toBe(0);
    await expect(b.service.report('w1', 'u9', dupInput)).resolves.toMatchObject({ deduped: false });
  });

  it('Redis không sẵn sàng hoặc lệnh Redis ném lỗi => rơi về khoá bộ nhớ, vẫn chỉ tạo MỘT bug', async () => {
    for (const redis of [fakeRedis(new Map(), false).service, null]) {
      const { service, issues } = make({ redis: redis ?? undefined });
      await Promise.all([
        service.report('w1', 'u9', dupInput),
        service.report('w1', 'u9', dupInput),
      ]);
      expect(issues.create).toHaveBeenCalledTimes(1);
    }
    const broken = fakeRedis();
    broken.client.set.mockRejectedValue(new Error('ECONNRESET'));
    const { service, issues } = make({ redis: broken.service });
    await Promise.all([service.report('w1', 'u9', dupInput), service.report('w1', 'u9', dupInput)]);
    expect(issues.create).toHaveBeenCalledTimes(1);
  });
});

describe('IntakeService.report — Redis lỗi lúc ghi kết quả', () => {
  it('ghi kết quả thất bại => xoá khoá pending (node khác không bị kẹt chờ)', async () => {
    const r = fakeRedis();
    r.client.set.mockImplementation((_k: string, _v: string, ...a: unknown[]) =>
      a.includes('NX') ? Promise.resolve('OK') : Promise.reject(new Error('boom')),
    );
    const { service } = make({ redis: r.service });
    await expect(service.report('w1', 'u9', dupInput)).resolves.toMatchObject({ deduped: false });
    expect(r.client.del).toHaveBeenCalledTimes(1);
  });
});

describe('IntakeService.report — dấu vân tay gồm severity/môi trường/loại', () => {
  const run = async (a: Record<string, unknown>, b: Record<string, unknown>) => {
    const { service, issues } = make();
    await service.report('w1', 'u9', { ...dupInput, ...a });
    await service.report('w1', 'u9', { ...dupInput, ...b });
    return issues.create.mock.calls.length;
  };
  it('khác severity, khác loại (typeId) hoặc khác môi trường => KHÔNG bị coi là gửi đôi', async () => {
    expect(await run({ severityId: 's1' }, { severityId: 's2' })).toBe(2);
    expect(await run({ typeId: 't1' }, { typeId: 't2' })).toBe(2);
    expect(
      await run({ environment: { browser: 'Chrome 1' } }, { environment: { browser: 'Safari 1' } }),
    ).toBe(2);
  });
  it('cùng môi trường khác thứ tự khoá, severity null = vắng => vẫn là gửi đôi', async () => {
    expect(
      await run(
        { environment: { browser: 'C', os: 'm' }, severityId: null },
        { environment: { os: 'm', browser: 'C' } },
      ),
    ).toBe(1);
  });
});

describe('IntakeService.report — báo trùng không đổi trạng thái duyệt của việc đã Nhận', () => {
  const dataOf = (m: { mock: { calls: unknown[][] } }) =>
    (m.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
  const merge = {
    projectId: 'p1',
    kind: 'BUG' as const,
    summary: 'Khác',
    mergeIntoIssueId: 'old1',
  };

  it.each([null, 'ACCEPTED', 'PENDING', 'SNOOZED'])(
    'việc đang ở triageState=%s: chỉ đếm báo lại + bình luận + watcher, KHÔNG ghi triageState',
    async (state) => {
      const { service, issueUpdate, comments, prisma } = make({ targetState: state });
      await service.report('w1', 'u9', merge);
      const data = dataOf(issueUpdate);
      expect(data).not.toHaveProperty('triageState');
      expect(data).toMatchObject({ occurrenceCount: { increment: 1 } });
      expect(comments.create).toHaveBeenCalledTimes(1);
      expect(prisma.issueWatcher.createMany).toHaveBeenCalledTimes(1);
    },
  );

  it('việc đã bị Từ chối (DECLINED) mà có người báo lại => quay về hàng chờ PENDING', async () => {
    const { service, issueUpdate } = make({ targetState: 'DECLINED' });
    await service.report('w1', 'u9', merge);
    expect(dataOf(issueUpdate)).toMatchObject({ triageState: 'PENDING' });
  });

  it('gộp tự động vào bug đang làm (ACCEPTED, status chưa Done) cũng giữ nguyên ACCEPTED', async () => {
    const accepted = { ...live, triageState: 'ACCEPTED', status: { category: 'IN_PROGRESS' } };
    const { service, issueUpdate } = make({
      existing: [accepted],
      similar: ['old1'],
      targetState: 'ACCEPTED',
    });
    const r = await service.report('w1', 'u9', {
      projectId: 'p1',
      kind: 'BUG',
      summary: 'Giỏ hàng bị mất sản phẩm',
    });
    expect(r).toMatchObject({ deduped: true, merged: 'auto' });
    expect(dataOf(issueUpdate)).not.toHaveProperty('triageState');
  });
});
