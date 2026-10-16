import { describe, expect, it, vi } from 'vitest';
import { NotFoundAppException } from '../../common/exceptions/app.exception';
import { SearchService } from './search.service';

const ACCESS = {
  visibleWhere: vi.fn().mockResolvedValue({}),
  visibleProjectIds: vi.fn().mockResolvedValue(null),
};

function makeService(rows: Array<{ id: string; rank: number }> | Error) {
  const queryRaw = vi.fn(() =>
    rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows),
  );
  const issues = { query: vi.fn().mockResolvedValue({ data: [], meta: {} }) };
  const prisma = {
    $queryRaw: queryRaw,
    project: { findMany: vi.fn().mockResolvedValue([{ id: 'P1' }]) },
  };
  const access = {
    visibleWhere: vi.fn().mockResolvedValue({}),
    visibleProjectIds: vi.fn().mockResolvedValue(null),
    assertCanSee: vi.fn().mockResolvedValue(undefined),
  };
  return {
    service: new SearchService(issues as never, prisma as never, access as never),
    issues,
    queryRaw,
    prisma,
    access,
  };
}

/** Tuỳ chọn thứ 7 của `issues.query` (rawIds/rankHint) — đối số thứ 6 là viewerId. */
const optsOf = (call: unknown[]) => (call[6] ?? {}) as { rawIds?: string[]; rankHint?: string[] };

describe('SearchService.search', () => {
  it('mode=text: full-text -> query(rawIds) giữ thứ tự rank, không orderBy', async () => {
    const { service, issues } = makeService([
      { id: 'I2', rank: 1 },
      { id: 'I1', rank: 0.5 },
    ]);
    await service.search('W1', 'U1', { mode: 'text', q: 'đăng nhập', limit: 8 });
    expect(issues.query).toHaveBeenCalledWith('W1', {}, [], undefined, 8, 'U1', {
      rawIds: ['I2', 'I1'],
    });
  });

  it('mode=text: FTS trả null (nhánh phòng thủ) -> contains ĐÃ ESCAPE trên summary/description/key', async () => {
    const { service, issues } = makeService([]);
    (service as unknown as { fulltext: { search: () => Promise<null> } }).fulltext = {
      search: () => Promise.resolve(null),
    };
    await service.search('W1', 'U1', { mode: 'text', q: '_', limit: 8 });
    const call = issues.query.mock.calls[0] as unknown[];
    const json = JSON.stringify(call[1]);
    expect(json).toContain('"contains":"\\\\_"');
    expect(json).not.toContain('"contains":"_"');
    expect(json).toContain('{"description":{"not":null}}');
    expect(optsOf(call).rawIds).toBeUndefined();
    // % và \ cũng được escape; mã issue (key) cũng đi qua cùng bộ lọc
    await service.search('W1', 'U1', { mode: 'text', q: '50%', limit: 8, projectId: 'P1' });
    const j2 = JSON.stringify((issues.query.mock.calls[1] as unknown[])[1]);
    expect(j2).toContain('"contains":"50\\\\%"');
    expect(j2).toContain('"projectId":"P1"');
  });

  it('mode=text với q rỗng -> trang rỗng, không tra DB', async () => {
    const { service, issues, queryRaw } = makeService([]);
    await service.search('W1', 'U1', { mode: 'text', q: ' ', limit: 8 });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(issues.query).toHaveBeenCalledWith('W1', {}, [], undefined, 8, 'U1', {
      rawIds: [],
    });
  });

  it('JQL text ~ trên chuỗi AND, không ORDER BY -> where lai (id in | contains) + rankHint theo rank', async () => {
    const { service, issues } = makeService([
      { id: 'I2', rank: 1 },
      { id: 'I1', rank: 0.5 },
    ]);
    await service.search('W1', 'U1', { jql: 'text ~ "foo"', limit: 50 });
    const call = issues.query.mock.calls[0] as unknown[];
    expect(JSON.stringify(call[1])).toContain('{"id":{"in":["I2","I1"]}}');
    expect(Object.keys(call[1] as object)).toEqual(['OR']);
    expect(optsOf(call).rawIds).toBeUndefined();
    expect(optsOf(call).rankHint).toEqual(['I2', 'I1']);
  });

  it('JQL project = ABC AND text ~ => FTS bị giới hạn project đã resolve (bind P1), không quét cả workspace', async () => {
    const { service, queryRaw, prisma } = makeService([{ id: 'I1', rank: 1 }]);
    await service.search('W1', 'U1', { jql: 'project = ABC AND text ~ "foo"', limit: 50 });
    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'W1', key: { in: ['ABC'] }, deletedAt: null },
      select: { id: true },
    });
    expect(JSON.stringify((queryRaw.mock.calls[0] as unknown[]).slice(1))).toContain('P1');
  });

  it('opts.projectId cũng thu hẹp FTS của JQL (không tra project khi JQL không có project =)', async () => {
    const { service, queryRaw, prisma } = makeService([{ id: 'I1', rank: 1 }]);
    await service.search('W1', 'U1', { jql: 'text ~ "foo"', projectId: 'P9', limit: 50 });
    expect(prisma.project.findMany).not.toHaveBeenCalled();
    expect(JSON.stringify((queryRaw.mock.calls[0] as unknown[]).slice(1))).toContain('P9');
  });

  it('project = ABC không khớp dự án nào => FTS ids rỗng, không chạm DB full-text', async () => {
    const { service, queryRaw, prisma } = makeService([{ id: 'I1', rank: 1 }]);
    prisma.project.findMany.mockResolvedValueOnce([]);
    await service.search('W1', 'U1', { jql: 'project = NOPE AND text ~ "foo"', limit: 50 });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('JQL có ORDER BY tường minh -> không ép thứ tự rank', async () => {
    const { service, issues } = makeService([{ id: 'I2', rank: 1 }]);
    await service.search('W1', 'U1', { jql: 'text ~ "foo" ORDER BY created DESC', limit: 50 });
    const call = issues.query.mock.calls[0] as unknown[];
    expect(optsOf(call).rawIds).toBeUndefined();
    expect(optsOf(call).rankHint).toBeUndefined();
  });

  it('orderByRank (board có filterJql): không ORDER BY => sắp theo rank tăng dần, không dùng rankHint; ORDER BY tường minh vẫn thắng', async () => {
    const { service, issues } = makeService([{ id: 'I2', rank: 1 }]);
    await service.search('W1', 'U1', { jql: 'text ~ "foo"', limit: 50, orderByRank: true });
    let call = issues.query.mock.calls[0] as unknown[];
    expect(call[2]).toEqual([{ rank: 'asc' }]);
    expect(optsOf(call).rankHint).toBeUndefined();
    await service.search('W1', 'U1', {
      jql: 'summary ~ "x" ORDER BY created DESC',
      limit: 50,
      orderByRank: true,
    });
    call = issues.query.mock.calls[1] as unknown[];
    expect(call[2]).toEqual([{ createdAt: 'desc' }]);
  });

  it('excludeUntriaged (board có filterJql): AND thêm điều kiện chỉ null/ACCEPTED; không bật thì JQL/tìm kiếm thường thấy mọi việc', async () => {
    const { service, issues } = makeService([]);
    await service.search('W1', 'U1', { jql: 'summary ~ "x"', limit: 50, excludeUntriaged: true });
    await service.search('W1', 'U1', { limit: 50, projectId: 'P1', excludeUntriaged: true });
    await service.search('W1', 'U1', { jql: 'summary ~ "x"', limit: 50 });
    const wheres = (issues.query.mock.calls as unknown as unknown[][]).map((c) =>
      JSON.stringify(c[1]),
    );
    const vis = '"OR":[{"triageState":null},{"triageState":"ACCEPTED"}]';
    expect(wheres[0]).toContain(vis);
    expect(wheres[1]).toContain(vis);
    expect(wheres[1]).toContain('"projectId":"P1"');
    expect(wheres[2]).not.toContain('triageState');
  });

  it('JQL không có text ~ -> không đụng full-text (hành vi cũ)', async () => {
    const { service, issues, queryRaw } = makeService([]);
    await service.search('W1', 'U1', { jql: 'summary ~ "x"', limit: 50 });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(optsOf(issues.query.mock.calls[0] as unknown[]).rawIds).toBeUndefined();
  });
});

describe('SearchService.fields — severities', () => {
  it('trả severities theo rank giảm, đủ value/label/color', async () => {
    const empty = vi.fn().mockResolvedValue([]);
    const severity = {
      findMany: vi.fn().mockResolvedValue([
        { name: 'Critical', color: '#f00' },
        { name: 'Minor', color: null },
      ]),
    };
    const prisma = {
      issueType: { findMany: empty },
      status: { findMany: empty },
      priority: { findMany: empty },
      sprint: { findMany: empty },
      label: { findMany: empty },
      resolution: { findMany: empty },
      component: { findMany: empty },
      version: { findMany: empty },
      severity,
    };
    const service = new SearchService({} as never, prisma as never, ACCESS as never);
    const out = await service.fields('W1', 'u0');
    expect(severity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'W1' }, orderBy: { rank: 'desc' } }),
    );
    expect(out.severities).toEqual([
      { value: 'Critical', label: 'Critical', color: '#f00' },
      { value: 'Minor', label: 'Minor', color: null },
    ]);
  });
});

describe('SearchService.fields — components/versions (B17)', () => {
  it('trả components/versions khử trùng theo tên', async () => {
    const empty = vi.fn().mockResolvedValue([]);
    const prisma = {
      issueType: { findMany: empty },
      status: { findMany: empty },
      priority: { findMany: empty },
      severity: { findMany: empty },
      sprint: { findMany: empty },
      label: { findMany: empty },
      resolution: { findMany: empty },
      component: {
        findMany: vi.fn().mockResolvedValue([{ name: 'API' }, { name: 'API' }, { name: 'Web' }]),
      },
      version: { findMany: vi.fn().mockResolvedValue([{ name: 'v1.0' }, { name: 'v1.0' }]) },
    };
    const service = new SearchService({} as never, prisma as never, ACCESS as never);
    const out = await service.fields('W1', 'u0');
    expect(prisma.component.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { project: { workspaceId: 'W1', deletedAt: null } },
        orderBy: { name: 'asc' },
      }),
    );
    expect(out.components).toEqual([
      { value: 'API', label: 'API', color: null },
      { value: 'Web', label: 'Web', color: null },
    ]);
    expect(out.versions).toEqual([{ value: 'v1.0', label: 'v1.0', color: null }]);
  });
});

describe('SearchService.similarIssueIds', () => {
  it('bọc FulltextSearcher theo dự án, trả id theo thứ tự xếp hạng; null/lỗi thiếu hạ tầng => []', async () => {
    const { service, queryRaw } = makeService([
      { id: 'I2', rank: 1 },
      { id: 'I1', rank: 0.5 },
    ]);
    expect(await service.similarIssueIds('W1', 'P1', 'giỏ hàng', null, 5)).toEqual(['I2', 'I1']);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    (service as unknown as { fulltext: { search: () => Promise<null> } }).fulltext = {
      search: () => Promise.resolve(null),
    };
    expect(await service.similarIssueIds('W1', 'P1', 'giỏ hàng', null)).toEqual([]);
  });
});

describe('SearchService — dự án riêng tư (P13)', () => {
  const visible = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };

  function makePrivate(visibleIds: string[] | null = ['P1']) {
    const base = makeService([{ id: 'I1', rank: 1 }]);
    base.access.visibleWhere.mockResolvedValue(visible);
    base.access.visibleProjectIds.mockResolvedValue(visibleIds);
    return base;
  }

  it('fields(w, viewer): sprint/nhãn/thành phần/phiên bản chỉ lấy từ dự án người xem thấy', async () => {
    const empty = vi.fn().mockResolvedValue([]);
    const prisma = {
      issueType: { findMany: empty },
      status: { findMany: empty },
      priority: { findMany: empty },
      severity: { findMany: empty },
      resolution: { findMany: empty },
      sprint: { findMany: vi.fn().mockResolvedValue([]) },
      label: { findMany: vi.fn().mockResolvedValue([]) },
      component: { findMany: vi.fn().mockResolvedValue([]) },
      version: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const access = { visibleWhere: vi.fn().mockResolvedValue(visible) };
    const service = new SearchService({} as never, prisma as never, access as never);
    await service.fields('w1', 'u1');
    for (const m of [prisma.sprint, prisma.label, prisma.component, prisma.version]) {
      expect(m.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { project: { workspaceId: 'w1', deletedAt: null, ...visible } },
        }),
      );
    }
  });

  it('JQL: truyền người xem làm đối số thứ 6 của issues.query', async () => {
    const { service, issues } = makePrivate();
    await service.search('W1', 'u1', { jql: 'summary ~ "x"', limit: 50 });
    expect((issues.query.mock.calls[0] as unknown[])[5]).toBe('u1');
  });

  it('JQL có excludeUntriaged vẫn giữ TRIAGE_VISIBLE và vẫn truyền người xem', async () => {
    const { service, issues } = makePrivate();
    await service.search('W1', 'u1', {
      jql: 'summary ~ "x"',
      limit: 50,
      excludeUntriaged: true,
    });
    const call = issues.query.mock.calls[0] as unknown[];
    expect(JSON.stringify(call[1])).toContain('triageState');
    expect(call[5]).toBe('u1');
  });

  it('text ~ trong JQL: full-text chỉ tìm trong dự án người xem thấy (không phí top-200 vào dự án ẩn)', async () => {
    const { service, queryRaw } = makePrivate(['P1', 'P3']);
    await service.search('W1', 'u1', { jql: 'text ~ "foo"', limit: 50 });
    const bound = JSON.stringify((queryRaw.mock.calls[0] as unknown[]).slice(1));
    expect(bound).toContain('P1');
    expect(bound).toContain('P3');
  });

  it('mode=text: giao projectId của người gọi với tập dự án thấy được; dự án ẩn → không kết quả', async () => {
    const { service, queryRaw, issues } = makePrivate(['P1']);
    await service.search('W1', 'u1', { mode: 'text', q: 'foo', projectId: 'HIDDEN', limit: 8 });
    // Giao rỗng → full-text không chạy SQL, kết quả rỗng; query cuối vẫn lọc theo người xem.
    expect(queryRaw).not.toHaveBeenCalled();
    expect(optsOf(issues.query.mock.calls[0] as unknown[]).rawIds).toEqual([]);
    expect((issues.query.mock.calls[0] as unknown[])[5]).toBe('u1');
  });

  it('admin (visibleProjectIds = null): không thu hẹp full-text', async () => {
    const { service, queryRaw } = makePrivate(null);
    await service.search('W1', 'u1', { mode: 'text', q: 'foo', limit: 8 });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('similarIssueIds(…, viewer): dự án riêng tư không thấy → 404 "Dự án", không chạm full-text', async () => {
    const { service, access, queryRaw } = makePrivate();
    access.assertCanSee.mockRejectedValue(new NotFoundAppException('Dự án'));
    await expect(service.similarIssueIds('W1', 'HR', 'lỗi', 'u1', 8)).rejects.toMatchObject({
      status: 404,
    });
    expect(access.assertCanSee).toHaveBeenCalledWith('u1', 'W1', 'HR', 'Dự án');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('similarIssueIds không viewer (hệ thống) → không kiểm quyền xem', async () => {
    const { service, access } = makePrivate();
    await service.similarIssueIds('W1', 'HR', 'lỗi', null);
    expect(access.assertCanSee).not.toHaveBeenCalled();
  });
});
