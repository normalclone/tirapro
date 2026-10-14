import { describe, expect, it, vi } from 'vitest';
import { SearchService } from './search.service';

function makeService(rows: Array<{ id: string; rank: number }> | Error) {
  const queryRaw = vi.fn(async () => {
    if (rows instanceof Error) throw rows;
    return rows;
  });
  const issues = { query: vi.fn().mockResolvedValue({ data: [], meta: {} }) };
  const prisma = { $queryRaw: queryRaw };
  return { service: new SearchService(issues as never, prisma as never), issues, queryRaw };
}

const missingColumn = Object.assign(new Error('Raw query failed'), { code: 'P2010', meta: { code: '42703' } });

describe('SearchService.search', () => {
  it('mode=text: full-text -> query(rawIds) giữ thứ tự rank, không orderBy', async () => {
    const { service, issues } = makeService([{ id: 'I2', rank: 1 }, { id: 'I1', rank: 0.5 }]);
    await service.search('W1', 'U1', { mode: 'text', q: 'đăng nhập', limit: 8 });
    expect(issues.query).toHaveBeenCalledWith('W1', {}, [], undefined, 8, ['I2', 'I1']);
  });

  it('mode=text: thiếu searchVector -> contains trên summary/description/key', async () => {
    const { service, issues } = makeService(missingColumn);
    await service.search('W1', 'U1', { mode: 'text', q: 'abc', limit: 8 });
    const call = issues.query.mock.calls[0] as unknown[];
    expect(JSON.stringify(call[1])).toContain('"contains":"abc"');
    expect(call[5]).toBeUndefined();
  });

  it('mode=text với q rỗng -> trang rỗng, không tra DB', async () => {
    const { service, issues, queryRaw } = makeService([]);
    await service.search('W1', 'U1', { mode: 'text', q: ' ', limit: 8 });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(issues.query).toHaveBeenCalledWith('W1', {}, [], undefined, 8, []);
  });

  it('JQL text ~ trên chuỗi AND, không ORDER BY -> where id in + rawIds theo rank', async () => {
    const { service, issues } = makeService([{ id: 'I2', rank: 1 }, { id: 'I1', rank: 0.5 }]);
    await service.search('W1', 'U1', { jql: 'text ~ "foo"', limit: 50 });
    const call = issues.query.mock.calls[0] as unknown[];
    expect(call[1]).toEqual({ id: { in: ['I2', 'I1'] } });
    expect(call[5]).toEqual(['I2', 'I1']);
  });

  it('JQL có ORDER BY tường minh -> không ép thứ tự rank', async () => {
    const { service, issues } = makeService([{ id: 'I2', rank: 1 }]);
    await service.search('W1', 'U1', { jql: 'text ~ "foo" ORDER BY created DESC', limit: 50 });
    expect((issues.query.mock.calls[0] as unknown[])[5]).toBeUndefined();
  });

  it('JQL không có text ~ -> không đụng full-text (hành vi cũ)', async () => {
    const { service, issues, queryRaw } = makeService([]);
    await service.search('W1', 'U1', { jql: 'summary ~ "x"', limit: 50 });
    expect(queryRaw).not.toHaveBeenCalled();
    expect((issues.query.mock.calls[0] as unknown[])[5]).toBeUndefined();
  });
});
