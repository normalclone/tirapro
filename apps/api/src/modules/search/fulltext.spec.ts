import { describe, expect, it, vi } from 'vitest';
import { buildFulltextQuery, FulltextSearcher, isMissingColumnError } from './fulltext';

/** Gom chuỗi SQL + tham số từ lời gọi tagged template `$queryRaw` (làm phẳng cả Prisma.sql lồng nhau). */
function renderCall(call: unknown[]): { sql: string; values: unknown[] } {
  const first = call[0] as string[] | { strings: readonly string[]; values: unknown[] };
  const strings = Array.isArray(first) ? first : first.strings;
  const vals = Array.isArray(first) ? call.slice(1) : first.values;
  let sql = '';
  const values: unknown[] = [];
  strings.forEach((str, i) => {
    sql += str;
    if (i >= vals.length) return;
    const v = vals[i];
    if (v && typeof v === 'object' && 'strings' in v && 'values' in v) {
      const inner = renderCall([v]);
      sql += inner.sql;
      values.push(...inner.values);
    } else {
      sql += '?';
      values.push(v);
    }
  });
  return { sql, values };
}

function makePrisma(impl: (...args: unknown[]) => unknown) {
  return { $queryRaw: vi.fn(impl) };
}

describe('buildFulltextQuery', () => {
  it('cắt khoảng trắng thừa, bỏ ký tự NUL và giới hạn độ dài', () => {
    expect(buildFulltextQuery('  đăng   nhập \u0000lỗi ')?.q).toBe('đăng nhập lỗi');
    expect(buildFulltextQuery('a'.repeat(500))?.q).toHaveLength(200);
  });

  it('trả null khi rỗng/chỉ khoảng trắng', () => {
    expect(buildFulltextQuery('   ')).toBeNull();
    expect(buildFulltextQuery('\u0000')).toBeNull();
  });

  it('escape ký tự đại diện của ILIKE (% _ \\) trong pattern', () => {
    expect(buildFulltextQuery('50%_off\\')?.like).toBe('%50\\%\\_off\\\\%');
    // q gửi cho websearch_to_tsquery giữ nguyên (không phải LIKE)
    expect(buildFulltextQuery('50%')?.q).toBe('50%');
  });
});

describe('isMissingColumnError', () => {
  it('nhận mã 42703 ở các dạng lỗi Prisma/pg', () => {
    expect(isMissingColumnError({ code: 'P2010', meta: { code: '42703', message: 'x' } })).toBe(
      true,
    );
    expect(isMissingColumnError({ code: '42703' })).toBe(true);
    expect(
      isMissingColumnError(
        new Error('Raw query failed. Code: `42703`. Message: column "searchVector" does not exist'),
      ),
    ).toBe(true);
  });
  it('không nhận lỗi khác', () => {
    expect(isMissingColumnError(new Error('timeout'))).toBe(false);
    expect(isMissingColumnError({ code: 'P2010', meta: { code: '57014' } })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });
});

describe('FulltextSearcher.search', () => {
  it('truy vấn tham số hoá (không nối chuỗi) và trả ids theo thứ tự rank', async () => {
    const prisma = makePrisma(() =>
      Promise.resolve([
        { id: 'I2', rank: 0.9 },
        { id: 'I1', rank: 0.1 },
      ]),
    );
    const res = await new FulltextSearcher(prisma as never).search(
      'W1',
      "đăng nhập'; DROP TABLE x;--",
    );
    expect(res).toEqual({ ids: ['I2', 'I1'] });
    const { sql, values } = renderCall(prisma.$queryRaw.mock.calls[0]!);
    expect(sql).toContain("websearch_to_tsquery('simple'");
    expect(sql).toContain('"searchVector"');
    expect(sql).not.toContain('DROP TABLE');
    expect(values).toContain("đăng nhập'; DROP TABLE x;--");
    expect(values).toContain('W1');
    expect(values.some((v) => typeof v === 'string' && v.startsWith('%') && v.endsWith('%'))).toBe(
      true,
    );
  });

  it('thêm điều kiện projectId (bind) khi có', async () => {
    const prisma = makePrisma(() => Promise.resolve([]));
    await new FulltextSearcher(prisma as never).search('W1', 'abc', { projectId: 'P1' });
    const { sql, values } = renderCall(prisma.$queryRaw.mock.calls[0]!);
    expect(sql).toContain('"projectId"');
    expect(values).toContain('P1');
  });

  it('chuỗi rỗng -> ids [] và không chạm DB', async () => {
    const prisma = makePrisma(() => Promise.resolve([]));
    expect(await new FulltextSearcher(prisma as never).search('W1', '  ')).toEqual({ ids: [] });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('thiếu cột searchVector (42703) -> null để gọi dùng contains, chỉ cảnh báo một lần', async () => {
    const prisma = makePrisma(() =>
      Promise.reject(
        Object.assign(new Error('Raw query failed'), { code: 'P2010', meta: { code: '42703' } }),
      ),
    );
    const logger = { warn: vi.fn() };
    const searcher = new FulltextSearcher(prisma as never, logger);
    expect(await searcher.search('W1', 'abc')).toBeNull();
    expect(await searcher.search('W1', 'def')).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String(logger.warn.mock.calls[0]?.[0])).toContain('db:raw');
  });

  it('lỗi DB khác được ném lại (không nuốt)', async () => {
    const prisma = makePrisma(() => Promise.reject(new Error('connection lost')));
    await expect(new FulltextSearcher(prisma as never).search('W1', 'abc')).rejects.toThrow(
      'connection lost',
    );
  });
});
