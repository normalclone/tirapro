import { describe, expect, it, vi } from 'vitest';
import { SearchService } from './search.service';

/** Người thấy mọi dự án (admin) — `visibleWhere` = `{}`. */
const ADMIN_ACCESS = { visibleWhere: vi.fn().mockResolvedValue({}) };

function makeService(rows: Array<{ id: string; rank: number }> | Error) {
  const queryRaw = vi.fn(() =>
    rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows),
  );
  const issues = { query: vi.fn().mockResolvedValue({ data: [], meta: {} }) };
  const prisma = {
    $queryRaw: queryRaw,
    project: { findMany: vi.fn().mockResolvedValue([{ id: 'P1' }]) },
  };
  return {
    service: new SearchService(issues as never, prisma as never, ADMIN_ACCESS as never),
    issues,
    queryRaw,
    prisma,
  };
}

describe('SearchService.search', () => {
  it('mode=text: full-text -> query(rawIds) giữ thứ tự rank, không orderBy', async () => {
    const { service, issues } = makeService([
      { id: 'I2', rank: 1 },
      { id: 'I1', rank: 0.5 },
    ]);
    await service.search('W1', 'U1', { mode: 'text', q: 'đăng nhập', limit: 8 });
    expect(issues.query).toHaveBeenCalledWith('W1', {}, [], undefined, 8, ['I2', 'I1']);
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
    expect(call[5]).toBeUndefined();
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
    expect(issues.query).toHaveBeenCalledWith('W1', {}, [], undefined, 8, []);
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
    expect(call[5]).toBeUndefined();
    expect(call[6]).toEqual(['I2', 'I1']);
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
    expect(call[5]).toBeUndefined();
    expect(call[6]).toBeUndefined();
  });

  it('orderByRank (board có filterJql): không ORDER BY => sắp theo rank tăng dần, không dùng rankHint; ORDER BY tường minh vẫn thắng', async () => {
    const { service, issues } = makeService([{ id: 'I2', rank: 1 }]);
    await service.search('W1', 'U1', { jql: 'text ~ "foo"', limit: 50, orderByRank: true });
    let call = issues.query.mock.calls[0] as unknown[];
    expect(call[2]).toEqual([{ rank: 'asc' }]);
    expect(call[6]).toBeUndefined();
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
    expect((issues.query.mock.calls[0] as unknown[])[5]).toBeUndefined();
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
    const service = new SearchService({} as never, prisma as never, ADMIN_ACCESS as never);
    const out = await service.fields('W1', 'U1');
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
    const service = new SearchService({} as never, prisma as never, ADMIN_ACCESS as never);
    const out = await service.fields('W1', 'U1');
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
    expect(await service.similarIssueIds('W1', 'P1', 'giỏ hàng', 5)).toEqual(['I2', 'I1']);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    (service as unknown as { fulltext: { search: () => Promise<null> } }).fulltext = {
      search: () => Promise.resolve(null),
    };
    expect(await service.similarIssueIds('W1', 'P1', 'giỏ hàng')).toEqual([]);
  });
});

describe('SearchService — kiểm giá trị JQL (U15)', () => {
  function make() {
    const issues = { query: vi.fn().mockResolvedValue({ data: [], meta: {} }) };
    const prisma = {
      status: { findMany: vi.fn().mockResolvedValue([{ name: 'In Progress' }, { name: 'Done' }]) },
      priority: { findMany: vi.fn().mockResolvedValue([{ name: 'High' }, { name: 'Low' }]) },
      project: { findMany: vi.fn().mockResolvedValue([{ key: 'DEMO' }]) },
      issueType: { findMany: vi.fn().mockResolvedValue([{ name: 'Bug' }, { name: 'Story' }]) },
      severity: { findMany: vi.fn().mockResolvedValue([{ name: 'Critical' }]) },
      // truy vấn tồn tại (có OR) chỉ thấy "Sprint 1"; danh mục (có take) trả danh sách cắt
      sprint: {
        findMany: vi.fn((args: { where: { OR?: unknown[] }; take?: number }) =>
          Promise.resolve(args.where.OR ? [{ name: 'Sprint 1' }] : [{ name: 'Sprint 100' }]),
        ),
      },
    };
    return {
      service: new SearchService(issues as never, prisma as never, ADMIN_ACCESS as never),
      issues,
      prisma,
    };
  }
  const run = (svc: SearchService, jql: string, checkValues?: boolean) =>
    svc.search('w1', 'u1', { mode: 'jql', jql, limit: 10, checkValues });

  it('checkValues: giá trị gần đúng → 422 kèm "ý bạn là"', async () => {
    const { service, issues } = make();
    await expect(run(service, 'status = "In Progresss"', true)).rejects.toThrow(
      'ý bạn là "In Progress"',
    );
    expect(issues.query).not.toHaveBeenCalled();
  });
  it('không bật checkValues (board / bộ lọc đã lưu) → KHÔNG ném, vẫn truy vấn như cũ', async () => {
    const { service, issues, prisma } = make();
    await run(service, 'status = "In Progresss"');
    expect(issues.query).toHaveBeenCalledTimes(1);
    expect(prisma.status.findMany).not.toHaveBeenCalled();
  });
  it('khác hoa/thường vẫn hợp lệ (compiler cũng so không phân biệt hoa/thường)', async () => {
    const { service, issues } = make();
    await run(service, 'status = done', true);
    expect(issues.query).toHaveBeenCalledTimes(1);
  });
  it('quá xa → liệt kê giá trị hiện có', async () => {
    const { service } = make();
    await expect(run(service, 'priority = zzzzzz', true)).rejects.toThrow(
      'Không có mức ưu tiên "zzzzzz". Các giá trị hiện có: High, Low',
    );
  });
  it('IN / NOT IN kiểm từng giá trị; trường khác (labels/summary/assignee) không bị kiểm', async () => {
    const { service, issues, prisma } = make();
    await expect(run(service, 'status IN (Done, Dne)', true)).rejects.toThrow('ý bạn là "Done"');
    await run(service, 'labels = lol AND summary ~ "x" AND assignee = me', true);
    expect(issues.query).toHaveBeenCalledTimes(1);
    expect(prisma.status.findMany).toHaveBeenCalledTimes(1); // chỉ lần của truy vấn đầu
  });
  it('sprint: kiểm tồn tại theo tên (không bị cắt 100), không phân biệt hoa/thường', async () => {
    const { service, issues, prisma } = make();
    await run(service, 'sprint = "sprint 1"', true);
    expect(issues.query).toHaveBeenCalledTimes(1);
    const call = prisma.sprint.findMany.mock.calls[0]![0];
    expect(call.take).toBeUndefined();
    expect(JSON.stringify(call.where)).toContain('"mode":"insensitive"');
    // sprint không tồn tại → mới tra danh mục để gợi ý
    await expect(run(service, 'sprint = "Sprint 2"', true)).rejects.toThrow(
      'Không có sprint "Sprint 2"',
    );
  });
  it('type / severity cũng được kiểm', async () => {
    const { service } = make();
    await expect(run(service, 'type = Bugg', true)).rejects.toThrow('ý bạn là "Bug"');
    await expect(run(service, 'severity = Critcal', true)).rejects.toThrow('ý bạn là "Critical"');
  });
  it('toán tử ~ / IS không bị kiểm', async () => {
    const { service, issues } = make();
    await run(service, 'status ~ "xyz" AND priority IS EMPTY', true);
    expect(issues.query).toHaveBeenCalledTimes(1);
  });
  it('validate: cú pháp sai giữ nguyên (kèm vị trí); giá trị sai → valid:false + suggestions', async () => {
    const { service } = make();
    expect(await service.validate('w1', 'u1', 'status =')).toMatchObject({ valid: false });
    expect((await service.validate('w1', 'u1', 'status =')).position).toBeTypeOf('number');
    const r = await service.validate('w1', 'u1', 'status = "In Progresss" AND project = DEMX');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('ý bạn là "In Progress"');
    expect(r.suggestions).toEqual([
      { field: 'status', value: 'In Progresss', didYouMean: 'In Progress' },
      { field: 'project', value: 'DEMX', didYouMean: 'DEMO' },
    ]);
    expect(await service.validate('w1', 'u1', 'status = Done')).toEqual({ valid: true });
  });
});

describe('SearchService — chỉ liệt kê/gợi ý dự án người hỏi được xem (dự án riêng tư)', () => {
  const VISIBLE = { OR: [{ isPrivate: false }, { memberships: { some: { userId: 'u1' } } }] };
  const rows = (...names: string[]) => names.map((name) => ({ name }));

  /** Mô phỏng DB: truy vấn KHÔNG có điều kiện visible thấy cả dự án riêng tư (SECRET), có thì chỉ thấy PUB. */
  function make() {
    const hasVisible = (where: { OR?: unknown; project?: { OR?: unknown } }) =>
      !!where.project?.OR || !!where.OR;
    const prisma = {
      project: {
        findMany: vi.fn((a: { where: { OR?: unknown } }) =>
          Promise.resolve(a.where.OR ? [{ key: 'PUB' }] : [{ key: 'PUB' }, { key: 'SECRET' }]),
        ),
      },
      sprint: {
        findMany: vi.fn((a: { where: { project?: { OR?: unknown }; OR?: unknown } }) =>
          Promise.resolve(
            a.where.project?.OR ? rows('Sprint Pub') : rows('Sprint Pub', 'Sprint Secret'),
          ),
        ),
      },
      component: {
        findMany: vi.fn((a: { where: { project?: { OR?: unknown } } }) =>
          Promise.resolve(a.where.project?.OR ? [] : rows('Secret Comp')),
        ),
      },
      version: {
        findMany: vi.fn((a: { where: { project?: { OR?: unknown } } }) =>
          Promise.resolve(a.where.project?.OR ? [] : rows('v9-secret')),
        ),
      },
      label: { findMany: vi.fn().mockResolvedValue([]) },
      issueType: { findMany: vi.fn().mockResolvedValue([]) },
      status: { findMany: vi.fn().mockResolvedValue([]) },
      priority: { findMany: vi.fn().mockResolvedValue([]) },
      severity: { findMany: vi.fn().mockResolvedValue([]) },
      resolution: { findMany: vi.fn().mockResolvedValue([]) },
    };
    void hasVisible;
    const access = { visibleWhere: vi.fn().mockResolvedValue(VISIBLE) };
    return {
      service: new SearchService({} as never, prisma as never, access as never),
      prisma,
      access,
    };
  }

  it('validate: khoá dự án riêng tư không lọt vào "ý bạn là" / danh sách giá trị', async () => {
    const { service, access } = make();
    const r = await service.validate('w1', 'u1', 'project = SECRE');
    expect(access.visibleWhere).toHaveBeenCalledWith('u1', 'w1');
    expect(r.valid).toBe(false);
    expect(JSON.stringify(r)).not.toContain('SECRET');
    expect(r.error).toContain('PUB');
  });
  it('sprint / thành phần / phiên bản của dự án riêng tư coi như không tồn tại, không được gợi ý lại', async () => {
    const { service } = make();
    // Gõ gần đúng tên riêng tư: nếu danh mục lộ, "ý bạn là" sẽ đưa đúng tên đó ra.
    for (const jql of [
      'sprint = "Sprint Secre"',
      'component = "Secret Com"',
      'fixVersion = "v9-secre"',
      'affectedVersion = "v9-secre"',
    ]) {
      const r = await service.validate('w1', 'u1', jql);
      expect(r.valid, jql).toBe(false);
      expect(JSON.stringify(r.suggestions), jql).not.toMatch(/Sprint Secret|Secret Comp|v9-secret/);
      expect(r.error ?? '', jql).not.toMatch(/ý bạn là "(Sprint Secret|Secret Comp|v9-secret)"/);
      expect(r.error ?? '', jql).not.toMatch(/hiện có:.*(Secret|secret)/);
    }
  });
  it('giá trị công khai vẫn hợp lệ (không phân biệt hoa/thường)', async () => {
    const { service } = make();
    expect(await service.validate('w1', 'u1', 'sprint = "sprint pub"')).toEqual({ valid: true });
  });
  it('fields(): sprint/nhãn/thành phần/phiên bản lọc theo dự án xem được', async () => {
    const { service, prisma } = make();
    const out = await service.fields('w1', 'u1');
    for (const m of [prisma.sprint, prisma.label, prisma.component, prisma.version]) {
      expect(m.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { project: { workspaceId: 'w1', deletedAt: null, ...VISIBLE } },
        }),
      );
    }
    expect(JSON.stringify(out)).not.toMatch(/Sprint Secret|Secret Comp|v9-secret/);
  });
});
