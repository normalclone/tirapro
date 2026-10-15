import { describe, expect, it, vi } from 'vitest';
import { SearchService } from './search.service';

function makeService(rows: Array<{ id: string; rank: number }> | Error) {
  const queryRaw = vi.fn(() =>
    rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows),
  );
  const issues = { query: vi.fn().mockResolvedValue({ data: [], meta: {} }) };
  const prisma = {
    $queryRaw: queryRaw,
    project: { findMany: vi.fn().mockResolvedValue([{ id: 'P1' }]) },
  };
  return { service: new SearchService(issues as never, prisma as never), issues, queryRaw, prisma };
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

  it('JQL không có text ~ -> không đụng full-text (hành vi cũ)', async () => {
    const { service, issues, queryRaw } = makeService([]);
    await service.search('W1', 'U1', { jql: 'summary ~ "x"', limit: 50 });
    expect(queryRaw).not.toHaveBeenCalled();
    expect((issues.query.mock.calls[0] as unknown[])[5]).toBeUndefined();
  });
});
